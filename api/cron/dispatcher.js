import { getDb, initDb, rowsToObjects, getSystemSetting } from '../_lib/db.js';
import * as evo from '../_lib/evolution.js';
import * as email from '../_lib/email.js';

const APP_URL = process.env.APP_URL || 'https://app.lumersbpo.com.br';

export default async function handler(req, res) {
  const isCron = req.headers['x-vercel-cron'] === '1';
  const secret = req.query.secret
    || req.headers['x-cron-secret']
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const cronSecret = process.env.CRON_SECRET;

  try {
    await initDb();

    // Auth: Vercel cron header, env secret, or DB-stored secret
    if (!isCron) {
      const envMatch = cronSecret && secret === cronSecret;
      if (!envMatch) {
        const dbSecret = await getSystemSetting('cron_secret');
        if (!dbSecret || secret !== dbSecret) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
      }
    }

    const db = getDb();
    const now = new Date().toISOString();
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Recycle orphaned processing rows (stuck > 5 min) back to pending — single UPDATE before loop
    await db.execute({
      sql: `UPDATE message_dispatch SET status='pending', processing_at=''
            WHERE status='processing' AND processing_at != '' AND processing_at <= ?`,
      args: [fiveMinAgo],
    });

    // Select pending dispatches due now (orphans above are now pending too)
    // libsql does not support UPDATE...LIMIT so we SELECT first, then claim atomically per row
    const { rows: candidates } = await db.execute({
      sql: `SELECT d.id, d.campaign_id, d.user_id, d.recipient_name, d.phone,
                   d.status, d.attempts, d.scheduled_for,
                   c.text, c.has_media, c.media_type, c.media_name, c.media_b64,
                   c.instance_name, c.created_by_id, c.created_by_name, c.created_by_email,
                   c.followup_enabled
            FROM message_dispatch d
            JOIN message_campaigns c ON c.id = d.campaign_id
            WHERE d.status = 'pending' AND d.scheduled_for <= ?
            LIMIT 15`,
      args: [now],
    });

    const dispatches = rowsToObjects(candidates);
    const processed = [];

    for (const d of dispatches) {
      // Atomic claim: only proceed if we win the race (pending only — no double-claim on processing)
      const claimRes = await db.execute({
        sql: `UPDATE message_dispatch SET status='processing', processing_at=?
              WHERE id=? AND status='pending'`,
        args: [now, d.id],
      });
      if (!claimRes.rowsAffected) continue;

      // Check instance is connected (DB as source of truth)
      const { rows: instRows } = await db.execute({
        sql: "SELECT name, api_key, connection_status FROM evolution_instances WHERE name=? LIMIT 1",
        args: [d.instance_name],
      });
      const inst = rowsToObjects(instRows)[0];
      const instStatus = inst?.connection_status || 'unknown';

      if (instStatus !== 'connected') {
        // Instance is down — release back to pending, retry on next tick
        await db.execute({
          sql: "UPDATE message_dispatch SET status='pending', processing_at='' WHERE id=?",
          args: [d.id],
        });
        processed.push({ id: d.id, result: 'deferred', reason: 'instance_down' });
        continue;
      }

      // Load user data for template personalization
      const [{ rows: uRows }, { rows: acctRows }] = await Promise.all([
        db.execute({
          sql: `SELECT u.name, u.email, u.phone, u.last_login,
                       p.active AS plan_active, p.name AS plan_name,
                       (SELECT MAX(created_at) FROM transactions WHERE user_id = u.id) AS last_tx_at
                FROM users u
                LEFT JOIN user_plans p ON p.user_id = u.id
                WHERE u.id = ?`,
          args: [d.user_id],
        }),
        db.execute({
          sql: "SELECT COALESCE(SUM(initial_balance), 0) AS saldo FROM accounts WHERE user_id=?",
          args: [d.user_id],
        }),
      ]);

      const target = rowsToObjects(uRows)[0] || { name: d.recipient_name, email: '', phone: d.phone };
      target.saldo = rowsToObjects(acctRows)[0]?.saldo ?? null;
      // Último acesso = mais recente entre login e última transação.
      target.last_active = [target.last_login, target.last_tx_at].filter(Boolean).sort().pop() || '';

      const personalizedText = evo.applyVars(evo.applySpin(d.text || ''), target);
      const hasMedia = !!d.has_media;

      let sendResult;
      try {
        if (hasMedia && d.media_b64) {
          sendResult = await evo.sendMedia({
            name: d.instance_name,
            key: inst.api_key || null,
            number: d.phone,
            mediatype: d.media_type || 'image',
            media: d.media_b64,
            caption: personalizedText,
            mimetype: evo.inferMimetype(d.media_b64, d.media_name),
            fileName: d.media_name || '',
          });
        } else {
          sendResult = await evo.sendText({
            name: d.instance_name,
            key: inst.api_key || null,
            number: d.phone,
            text: personalizedText,
          });
        }
      } catch (sendErr) {
        sendResult = { ok: false, data: {}, status: 0, _error: sendErr.message };
      }

      const msgId = sendResult?.data?.key?.id
        || sendResult?.data?.message?.key?.id
        || '';

      if (sendResult?.ok) {
        await db.execute({
          sql: "UPDATE message_dispatch SET status='sent', sent_at=?, message_id=? WHERE id=?",
          args: [now, msgId, d.id],
        });
        await db.execute({
          sql: "UPDATE message_campaigns SET sent=sent+1 WHERE id=?",
          args: [d.campaign_id],
        });
        // Follow-up automático: se a campanha pediu, registra o destinatário para
        // receber lembretes caso não responda (processado no BLOCK D).
        if ((d.followup_enabled === 1 || d.followup_enabled === '1') && d.phone) {
          await db.execute({
            sql: `INSERT INTO message_followups
                    (id, campaign_id, user_id, phone, recipient_name, instance_name,
                     original_sent_at, followups_sent, last_sent_at, status, created_at)
                  VALUES (?,?,?,?,?,?,?,0,'','active',datetime('now'))`,
            args: [
              crypto.randomUUID(), d.campaign_id, d.user_id, d.phone,
              target.name || d.recipient_name || '', d.instance_name, now,
            ],
          });
        }
        await db.execute({
          sql: `INSERT INTO message_logs
                  (id,sent_by_id,sent_by_name,sent_by_email,instance_name,
                   recipient_id,recipient_name,recipient_phone,message_text,
                   has_media,media_type,media_name,status,error,message_id,sent_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
          args: [
            crypto.randomUUID(),
            d.created_by_id, d.created_by_name, d.created_by_email,
            d.instance_name,
            d.user_id, target.name || '', d.phone,
            personalizedText,
            hasMedia ? 1 : 0, d.media_type || '', d.media_name || '',
            'ok', '', msgId,
          ],
        });
        processed.push({ id: d.id, result: 'sent' });
      } else {
        const errMsg = sendResult?._error
          || evo.parseEvoError(sendResult?.data, sendResult?.status);
        const attempts = (Number(d.attempts) || 0) + 1;

        if (attempts < 3) {
          const retryAt = new Date(Date.now() + 30_000).toISOString();
          await db.execute({
            sql: "UPDATE message_dispatch SET status='pending', attempts=?, scheduled_for=?, processing_at='', error=? WHERE id=?",
            args: [attempts, retryAt, errMsg, d.id],
          });
          processed.push({ id: d.id, result: 'retry', attempts });
        } else {
          await db.execute({
            sql: "UPDATE message_dispatch SET status='failed', attempts=?, error=? WHERE id=?",
            args: [attempts, errMsg, d.id],
          });
          await db.execute({
            sql: "UPDATE message_campaigns SET failed=failed+1 WHERE id=?",
            args: [d.campaign_id],
          });
          await db.execute({
            sql: `INSERT INTO message_logs
                    (id,sent_by_id,sent_by_name,sent_by_email,instance_name,
                     recipient_id,recipient_name,recipient_phone,message_text,
                     has_media,media_type,media_name,status,error,sent_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
            args: [
              crypto.randomUUID(),
              d.created_by_id, d.created_by_name, d.created_by_email,
              d.instance_name,
              d.user_id, target.name || '', d.phone,
              personalizedText,
              hasMedia ? 1 : 0, d.media_type || '', d.media_name || '',
              'failed', errMsg,
            ],
          });
          processed.push({ id: d.id, result: 'failed', error: errMsg });
        }
      }

      // Mark campaign done when no more pending/processing rows remain
      const { rows: remainRows } = await db.execute({
        sql: "SELECT COUNT(*) as cnt FROM message_dispatch WHERE campaign_id=? AND status IN ('pending','processing')",
        args: [d.campaign_id],
      });
      const remain = Number(rowsToObjects(remainRows)[0]?.cnt || 0);
      if (remain === 0) {
        await db.execute({
          sql: "UPDATE message_campaigns SET status='done' WHERE id=? AND status='running'",
          args: [d.campaign_id],
        });
      }
    }

    // ===================================================================
    // BLOCK A — process email_dispatch queue (mirrors message_dispatch)
    // ===================================================================
    const emailProcessed = [];

    // Recycle orphaned processing rows (stuck > 5 min) back to pending
    await db.execute({
      sql: `UPDATE email_dispatch SET status='pending', processing_at=''
            WHERE status='processing' AND processing_at != '' AND processing_at <= ?`,
      args: [fiveMinAgo],
    });

    const { rows: emailCandidates } = await db.execute({
      sql: `SELECT d.id, d.campaign_id, d.user_id, d.to_email, d.to_name,
                   d.subject, d.html, d.status, d.attempts, d.scheduled_for, d.force_send
            FROM email_dispatch d
            JOIN email_campaigns c ON c.id = d.campaign_id
            WHERE d.status = 'pending' AND d.scheduled_for <= ?
            LIMIT 15`,
      args: [now],
    });

    const emailDispatches = rowsToObjects(emailCandidates);

    // Vars de marca resolvidas UMA vez por tick (reaproveitadas p/ todos os destinatários).
    const brandVars = emailDispatches.length ? await email.getBrandVars() : {};

    for (const d of emailDispatches) {
      // Atomic claim: only proceed if we win the race (pending only)
      const claimRes = await db.execute({
        sql: `UPDATE email_dispatch SET status='processing', processing_at=?
              WHERE id=? AND status='pending'`,
        args: [now, d.id],
      });
      if (!claimRes.rowsAffected) continue;

      // Promote scheduled campaigns queued->running once sending begins,
      // so they can later transition to 'done' (no-op if already running)
      await db.execute({
        sql: "UPDATE email_campaigns SET status='running' WHERE id=? AND status='queued'",
        args: [d.campaign_id],
      });

      // Per-recipient render: vars de marca primeiro, depois as específicas do destinatário.
      const vars = { ...brandVars, name: d.to_name || '', app_url: APP_URL };
      const subject = email.renderTemplate(d.subject || '', vars);
      const html = email.renderTemplate(d.html || '', vars);

      // email.sendEmail never throws and already writes email_log
      const r = await email.sendEmail({
        to: d.to_email,
        toName: d.to_name,
        subject,
        html,
        campaignId: d.campaign_id,
        force: d.force_send === 1 || d.force_send === '1',
      });

      if (r.ok) {
        await db.execute({
          sql: "UPDATE email_dispatch SET status='sent', sent_at=?, message_id=? WHERE id=?",
          args: [now, r.id || '', d.id],
        });
        await db.execute({
          sql: "UPDATE email_campaigns SET sent=sent+1 WHERE id=?",
          args: [d.campaign_id],
        });
        emailProcessed.push({ id: d.id, result: 'sent' });
      } else if (r.skipped) {
        // Email desabilitado / sem api key / destinatário optou por não receber —
        // NUNCA re-tentar (loop infinito), falha direto com o motivo real.
        const skipMsg = r.optedOut ? 'notificações desabilitadas' : 'email disabled';
        await db.execute({
          sql: "UPDATE email_dispatch SET status='failed', processing_at='', error=? WHERE id=?",
          args: [skipMsg, d.id],
        });
        await db.execute({
          sql: "UPDATE email_campaigns SET failed=failed+1 WHERE id=?",
          args: [d.campaign_id],
        });
        emailProcessed.push({ id: d.id, result: 'failed', error: skipMsg });
      } else {
        const errMsg = r.error || 'send error';
        const attempts = (Number(d.attempts) || 0) + 1;

        if (attempts < 3) {
          const retryAt = new Date(Date.now() + 30_000).toISOString();
          await db.execute({
            sql: "UPDATE email_dispatch SET status='pending', attempts=?, scheduled_for=?, processing_at='', error=? WHERE id=?",
            args: [attempts, retryAt, errMsg, d.id],
          });
          emailProcessed.push({ id: d.id, result: 'retry', attempts });
        } else {
          await db.execute({
            sql: "UPDATE email_dispatch SET status='failed', attempts=?, processing_at='', error=? WHERE id=?",
            args: [attempts, errMsg, d.id],
          });
          await db.execute({
            sql: "UPDATE email_campaigns SET failed=failed+1 WHERE id=?",
            args: [d.campaign_id],
          });
          emailProcessed.push({ id: d.id, result: 'failed', error: errMsg });
        }
      }

      // Mark campaign done when no more pending/processing rows remain
      const { rows: remainRows } = await db.execute({
        sql: "SELECT COUNT(*) as cnt FROM email_dispatch WHERE campaign_id=? AND status IN ('pending','processing')",
        args: [d.campaign_id],
      });
      const remain = Number(rowsToObjects(remainRows)[0]?.cnt || 0);
      if (remain === 0) {
        await db.execute({
          sql: "UPDATE email_campaigns SET status='done' WHERE id=? AND status IN ('running','queued')",
          args: [d.campaign_id],
        });
      }
    }

    // ===================================================================
    // BLOCK B — plan expiry reminders (monthly anniversary, best-effort)
    // ===================================================================
    // Product rule: a plan's due date is MONTHLY, on the same day-of-month as
    // its created_at. There is NO due-date column — we compute the next due
    // date in JS from created_at. We NEVER alter the schema.
    let reminderCount = 0;
    try {
      // "Today" as a UTC calendar day (hours zeroed) for off-by-one-safe compares.
      const now2 = new Date();
      const todayUTC = new Date(Date.UTC(now2.getUTCFullYear(), now2.getUTCMonth(), now2.getUTCDate()));

      // Last day of a given UTC year/month (month is 0-based). Day 0 of the
      // following month rolls back to the last day of the target month.
      const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

      // Build a UTC date for year/month with day D, clamped to the month's length
      // (e.g. D=31 in February clamps to 28/29).
      const buildDue = (y, m, d) => {
        const clamped = Math.min(d, lastDayOfMonth(y, m));
        return new Date(Date.UTC(y, m, clamped));
      };

      // Format a UTC date as DD/MM/AAAA (pt-BR).
      const fmtBR = (dt) => {
        const dd = String(dt.getUTCDate()).padStart(2, '0');
        const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const yyyy = dt.getUTCFullYear();
        return `${dd}/${mm}/${yyyy}`;
      };

      // Candidates: active plans whose user has an email. Opt-in respected via
      // LEFT JOIN — include when the pref is ABSENT (null) OR enabled=1.
      const { rows: planRows } = await db.execute({
        sql: `SELECT p.id AS plan_id, p.created_at, p.name AS plan_name,
                     u.id AS user_id, u.name AS user_name, u.email AS email
              FROM user_plans p
              JOIN users u ON u.id = p.user_id
              LEFT JOIN user_notification_prefs np
                     ON np.user_id = u.id AND np.notif_key = 'plan_expiry'
              WHERE p.active = 1
                AND u.email IS NOT NULL AND u.email != ''
                AND (np.enabled IS NULL OR np.enabled = 1)
              LIMIT 500`,
      });

      const plans = rowsToObjects(planRows);
      const MAX_SENDS = 50;

      for (const p of plans) {
        if (reminderCount >= MAX_SENDS) break;
        try {
          const rawCreated = String(p.created_at);
          const createdUTC = /[TZ]/.test(rawCreated)
            ? rawCreated
            : rawCreated.replace(' ', 'T') + 'Z';
          const created = new Date(createdUTC);
          if (isNaN(created.getTime())) continue;

          // Day-of-month D from created_at, then this month's due date (clamped).
          const D = created.getUTCDate();
          let dueDate = buildDue(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), D);

          // If this month's due date already passed, advance to the same day
          // next month (with the same clamp).
          if (dueDate < todayUTC) {
            dueDate = buildDue(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth() + 1, D);
          }

          // Eligibility: due within 0..3 days ahead (inclusive).
          const in3Days = new Date(todayUTC.getTime() + 3 * 24 * 60 * 60 * 1000);
          if (dueDate < todayUTC || dueDate > in3Days) continue;

          // Dedupe per cycle: skip if a plan_expiry email was already sent to
          // this address within the last 10 days before dueDate (one reminder
          // per monthly cycle, not one per day).
          const windowStart = new Date(dueDate.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
          const { rows: dupRows } = await db.execute({
            sql: `SELECT 1 FROM email_log
                  WHERE template_key='plan_expiry' AND to_email=? AND sent_at >= ? AND status='sent'
                  LIMIT 1`,
            args: [p.email, windowStart],
          });
          if (rowsToObjects(dupRows).length > 0) continue;

          const r = await email.sendTemplateEmail({
            to: p.email,
            toName: p.user_name,
            systemKey: 'plan_expiry',
            vars: {
              name: (p.user_name || '').split(' ')[0] || '',
              plan_name: p.plan_name || '',
              expiry_date: fmtBR(dueDate),
              app_url: APP_URL,
            },
          });
          if (r.ok) reminderCount++;
        } catch (perUserErr) {
          console.error('[dispatcher] plan_expiry per-user error', perUserErr && perUserErr.message);
        }
      }
    } catch (blockBErr) {
      console.error('[dispatcher] plan_expiry block error', blockBErr && blockBErr.message);
    }

    // ===================================================================
    // BLOCK C — regras de notificação automática (inatividade / sem lançamentos)
    // ===================================================================
    // O admin define regras com critério (N dias sem acessar OU N dias sem
    // registrar lançamentos), canais (e-mail/WhatsApp) e o modelo de cada canal.
    // Aqui avaliamos as regras ativas, encontramos os usuários que batem no
    // critério e disparamos — respeitando o cooldown (reenvio mínimo) e o opt-out
    // de e-mail. Nada de schema novo além das tabelas notification_rules /
    // notification_rule_sends.
    let ruleSends = 0;
    try {
      const { rows: ruleRows } = await db.execute("SELECT * FROM notification_rules WHERE active = 1");
      const rules = rowsToObjects(ruleRows);
      const RULE_MAX_SENDS = 50;

      // Instância WhatsApp padrão — resolvida uma vez se alguma regra usar o canal.
      let waInstance = null;
      const anyWa = rules.some(r => r.channel_whatsapp === 1 || r.channel_whatsapp === '1');
      if (anyWa) {
        const { rows: waRows } = await db.execute("SELECT name, api_key, connection_status FROM evolution_instances WHERE is_default=1 LIMIT 1");
        waInstance = rowsToObjects(waRows)[0] || null;
      }

      const brandVarsRules = rules.length ? await email.getBrandVars() : {};
      const oneDayAgoIso = new Date(Date.now() - 86400000).toISOString();

      for (const rule of rules) {
        if (ruleSends >= RULE_MAX_SENDS) break;
        const threshold = Math.max(1, Number(rule.threshold_days) || 1);
        const cooldownDays = Math.max(1, Number(rule.cooldown_days) || 30);
        const cutoffIso = new Date(Date.now() - threshold * 86400000).toISOString();
        const cooldownIso = new Date(Date.now() - cooldownDays * 86400000).toISOString();
        const wantEmail = rule.channel_email === 1 || rule.channel_email === '1';
        const wantWa = rule.channel_whatsapp === 1 || rule.channel_whatsapp === '1';

        // Modelo de e-mail (subject/html) — carregado uma vez por regra.
        let tplSubject = '', tplHtml = '';
        if (wantEmail && rule.email_template_id) {
          const { rows: tRows } = await db.execute({ sql: 'SELECT subject, html FROM email_templates WHERE id = ?', args: [rule.email_template_id] });
          const tpl = rowsToObjects(tRows)[0];
          if (tpl) { tplSubject = tpl.subject || ''; tplHtml = tpl.html || ''; }
        }

        // Usuários que batem no critério.
        let candSql;
        if (rule.condition_type === 'no_transactions_days') {
          candSql = {
            sql: `SELECT u.id AS user_id, u.name, u.email, u.phone,
                         p.active AS plan_active, p.name AS plan_name
                  FROM users u LEFT JOIN user_plans p ON p.user_id = u.id
                  WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = u.id AND t.created_at > ?)
                  LIMIT 500`,
            args: [cutoffIso],
          };
        } else {
          // inactive_days: última atividade = last_login (ou created_at se nunca logou)
          candSql = {
            sql: `SELECT u.id AS user_id, u.name, u.email, u.phone,
                         p.active AS plan_active, p.name AS plan_name
                  FROM users u LEFT JOIN user_plans p ON p.user_id = u.id
                  WHERE COALESCE(NULLIF(u.last_login, ''), u.created_at) <= ?
                  LIMIT 500`,
            args: [cutoffIso],
          };
        }
        const { rows: candRows } = await db.execute(candSql);
        const candidates = rowsToObjects(candRows);

        for (const u of candidates) {
          if (ruleSends >= RULE_MAX_SENDS) break;

          // Throttle/cooldown: pula se já houve envio bem-sucedido dentro do
          // cooldown, OU qualquer tentativa nas últimas 24h (evita reprocessar a
          // cada tick; falhas transitórias re-tentam no máximo 1x/dia).
          const { rows: recentRows } = await db.execute({
            sql: `SELECT 1 FROM notification_rule_sends
                  WHERE rule_id = ? AND user_id = ?
                    AND ((status = 'sent' AND sent_at >= ?) OR sent_at >= ?)
                  LIMIT 1`,
            args: [rule.id, u.user_id, cooldownIso, oneDayAgoIso],
          });
          if (rowsToObjects(recentRows).length > 0) continue;

          const firstName = (u.name || '').split(' ')[0] || '';
          let didSend = false;

          // E-mail — respeita opt-out (sendEmail bloqueia quem desabilitou).
          if (wantEmail && u.email && tplHtml) {
            const vars = { ...brandVarsRules, name: firstName, app_url: APP_URL };
            const subject = email.renderTemplate(tplSubject, vars);
            const html = email.renderTemplate(tplHtml, vars);
            const r = await email.sendEmail({
              to: u.email, toName: u.name || '', subject, html,
              templateKey: 'rule:' + rule.id,
            });
            await db.execute({
              sql: "INSERT INTO notification_rule_sends (id, rule_id, user_id, channel, status, error) VALUES (?, ?, ?, 'email', ?, ?)",
              args: [crypto.randomUUID(), rule.id, u.user_id, r.ok ? 'sent' : 'failed', r.ok ? '' : (r.error || '')],
            });
            if (r.ok) { didSend = true; ruleSends++; }
          }

          // WhatsApp — só se a instância padrão estiver conectada e o usuário tiver telefone.
          if (wantWa && u.phone && waInstance && waInstance.connection_status === 'connected') {
            const text = evo.applyVars(evo.applySpin(rule.whatsapp_text || ''), {
              name: u.name, email: u.email, phone: u.phone,
              plan_active: u.plan_active, plan_name: u.plan_name, saldo: null,
            });
            let waOk = false, waErr = '';
            try {
              const sr = await evo.sendText({ name: waInstance.name, key: waInstance.api_key || null, number: u.phone, text });
              waOk = !!sr.ok;
            } catch (e) { waErr = e.message || 'erro'; }
            await db.execute({
              sql: "INSERT INTO notification_rule_sends (id, rule_id, user_id, channel, status, error) VALUES (?, ?, ?, 'whatsapp', ?, ?)",
              args: [crypto.randomUUID(), rule.id, u.user_id, waOk ? 'sent' : 'failed', waErr],
            });
            if (waOk) { didSend = true; ruleSends++; }
          }

          // Nenhum canal enviou (sem contato válido / opt-out): grava marca para
          // não reavaliar o mesmo usuário a cada tick (retry no máx. 1x/dia).
          if (!didSend) {
            await db.execute({
              sql: "INSERT INTO notification_rule_sends (id, rule_id, user_id, channel, status, error) VALUES (?, ?, ?, 'none', 'skipped', '')",
              args: [crypto.randomUUID(), rule.id, u.user_id],
            });
          }
        }
      }
    } catch (blockCErr) {
      console.error('[dispatcher] notification_rules block error', blockCErr && blockCErr.message);
    }

    // ===================================================================
    // BLOCK D — follow-ups de campanhas de atualização
    // ===================================================================
    // Quando o admin habilita follow-up numa mensagem em massa, cada destinatário
    // que recebeu a mensagem ganha uma linha em message_followups. Aqui, a cada 3h
    // sem resposta, reenviamos um lembrete curto (até 3 vezes). Se a pessoa
    // responder/interagir (registrou algo no assistente), encerramos os follow-ups.
    let followupSends = 0;
    try {
      const FOLLOWUP_GAP_MS = 3 * 60 * 60 * 1000; // 3 horas
      const FOLLOWUP_MAX = 3;
      const FOLLOWUP_TEXTS = [
        'Olá! 👋 Você está por aí? Vi que ainda não tive um retorno seu sobre a novidade que enviei. O que achou? Já testou? Estou por aqui pra ajudar. 🙂',
        'Oi! Passando pra saber se você conseguiu dar uma olhada na atualização. Qualquer dúvida, é só me chamar — estou à disposição. 😉',
        'Olá! Ainda dá tempo de conferir a novidade. Se precisar de uma mãozinha pra testar ou tiver qualquer dúvida, me avise. 💬',
      ];
      const cutoffIso = new Date(Date.now() - FOLLOWUP_GAP_MS).toISOString();

      const { rows: fuRows } = await db.execute({
        sql: `SELECT id, campaign_id, user_id, phone, recipient_name, instance_name,
                     original_sent_at, followups_sent, last_sent_at, status
              FROM message_followups
              WHERE status='active' AND followups_sent < ?
                AND COALESCE(NULLIF(last_sent_at,''), original_sent_at) <= ?
              LIMIT 50`,
        args: [FOLLOWUP_MAX, cutoffIso],
      });
      const followups = rowsToObjects(fuRows);
      const instCache = {};

      for (const f of followups) {
        // A pessoa respondeu/interagiu desde o envio original? (mensagem recebida)
        const last8 = String(f.phone || '').replace(/\D/g, '').slice(-8);
        if (last8) {
          const { rows: intRows } = await db.execute({
            sql: `SELECT 1 FROM wa_interactions
                  WHERE phone LIKE ? AND created_at > ? LIMIT 1`,
            args: ['%' + last8, f.original_sent_at],
          });
          if (rowsToObjects(intRows).length > 0) {
            await db.execute({
              sql: "UPDATE message_followups SET status='done_responded' WHERE id=?",
              args: [f.id],
            });
            continue;
          }
        }

        // Instância conectada? (cache por nome)
        if (!(f.instance_name in instCache)) {
          const { rows: iRows } = await db.execute({
            sql: "SELECT name, api_key, connection_status FROM evolution_instances WHERE name=? LIMIT 1",
            args: [f.instance_name],
          });
          instCache[f.instance_name] = rowsToObjects(iRows)[0] || null;
        }
        const fuInst = instCache[f.instance_name];
        if (!fuInst || fuInst.connection_status !== 'connected') continue; // adia p/ próximo tick

        const idx = Math.min(Number(f.followups_sent) || 0, FOLLOWUP_TEXTS.length - 1);
        const text = evo.applyVars(FOLLOWUP_TEXTS[idx], { name: f.recipient_name || '' });

        let ok = false;
        try {
          const sr = await evo.sendText({ name: fuInst.name, key: fuInst.api_key || null, number: f.phone, text });
          ok = !!sr.ok;
        } catch (e) { ok = false; }

        if (ok) {
          const nextCount = (Number(f.followups_sent) || 0) + 1;
          const nowIso = new Date().toISOString();
          await db.execute({
            sql: "UPDATE message_followups SET followups_sent=?, last_sent_at=?, status=? WHERE id=?",
            args: [nextCount, nowIso, nextCount >= FOLLOWUP_MAX ? 'done_maxed' : 'active', f.id],
          });
          followupSends++;
        }
      }
    } catch (blockDErr) {
      console.error('[dispatcher] follow-up block error', blockDErr && blockDErr.message);
    }

    // ===================================================================
    // BLOCK E — resumo diário do mês (17h BRT) + lembrete de inatividade
    // ===================================================================
    // Todo dia, às 17h (horário de Brasília), enviamos ao usuário um resumo do MÊS
    // atual (receitas, despesas e saldo). Se a pessoa não registrou NENHUM valor no
    // dia, anexamos um lembrete convidando a interagir. Dedupe: 1 envio por dia por
    // usuário (marca em notification_rule_sends com rule_id='daily_summary').
    let dailySummarySends = 0;
    try {
      // "Agora" em horário de Brasília (UTC-3, sem DST desde 2019).
      const nowBRT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
      const hourBRT = nowBRT.getHours();

      // Só dispara dentro da janela das 17h BRT (o dedupe evita repetição no minuto).
      if (hourBRT === 17) {
        const yBRT = nowBRT.getFullYear();
        const mBRT = nowBRT.getMonth() + 1;
        const dBRT = nowBRT.getDate();
        // Início do dia BRT (00:00) expresso em UTC = 03:00Z da mesma data.
        const dayStartUtc = new Date(Date.UTC(yBRT, mBRT - 1, dBRT, 3, 0, 0)).toISOString();
        const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
        const nomeMes = MESES[mBRT - 1];
        const brl = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // Instância padrão conectada (canal WhatsApp).
        const { rows: dsInstRows } = await db.execute("SELECT name, api_key, connection_status FROM evolution_instances WHERE is_default=1 LIMIT 1");
        const dsInst = rowsToObjects(dsInstRows)[0] || null;

        if (dsInst && dsInst.connection_status === 'connected') {
          // Modo de notificação por usuário (wa_notify). O resumo vale para os
          // modos daily/weekly/biweekly; 'off' e 'bills_only' são excluídos.
          //   daily    → todo dia
          //   weekly   → só na segunda-feira BRT
          //   biweekly → segunda-feira BRT e sem resumo enviado nos últimos 13 dias
          const isMonday = nowBRT.getDay() === 1;
          const biweeklyCutoffUtc = new Date(Date.now() - 13 * 86400000).toISOString();
          const { rows: dsUserRows } = await db.execute({
            sql: `SELECT u.id AS user_id, u.name, u.phone, np.value AS wa_mode
                  FROM users u
                  JOIN user_plans p ON p.user_id = u.id
                  LEFT JOIN user_notification_prefs np
                         ON np.user_id = u.id AND np.notif_key = 'wa_notify'
                  WHERE p.active = 1
                    AND u.phone IS NOT NULL AND u.phone != ''
                    AND (np.value IS NULL OR np.value NOT IN ('off','bills_only'))
                  LIMIT 500`,
          });
          const dsUsers = rowsToObjects(dsUserRows);
          const DS_MAX = 200;

          for (const u of dsUsers) {
            if (dailySummarySends >= DS_MAX) break;

            // Aplica a cadência do modo escolhido (padrão: daily).
            const waMode = (u.wa_mode || 'daily');
            if (waMode === 'weekly' && !isMonday) continue;
            if (waMode === 'biweekly') {
              if (!isMonday) continue;
              const { rows: recentRows } = await db.execute({
                sql: `SELECT 1 FROM notification_rule_sends
                      WHERE rule_id='daily_summary' AND user_id=? AND status='sent' AND sent_at >= ? LIMIT 1`,
                args: [u.user_id, biweeklyCutoffUtc],
              });
              if (rowsToObjects(recentRows).length > 0) continue;
            }

            // Dedupe: já enviou hoje?
            const { rows: dupRows } = await db.execute({
              sql: `SELECT 1 FROM notification_rule_sends
                    WHERE rule_id='daily_summary' AND user_id=? AND sent_at >= ? LIMIT 1`,
              args: [u.user_id, dayStartUtc],
            });
            if (rowsToObjects(dupRows).length > 0) continue;

            // Totais do mês.
            const { rows: totRows } = await db.execute({
              sql: `SELECT
                       COALESCE(SUM(CASE WHEN transaction_type='income'  THEN amount ELSE 0 END),0) AS income,
                       COALESCE(SUM(CASE WHEN transaction_type='expense' THEN amount ELSE 0 END),0) AS expense,
                       COUNT(*) AS cnt
                     FROM transactions WHERE user_id=? AND month=? AND year=?`,
              args: [u.user_id, mBRT, yBRT],
            });
            const tot = rowsToObjects(totRows)[0] || { income: 0, expense: 0, cnt: 0 };
            const income = Number(tot.income) || 0;
            const expense = Number(tot.expense) || 0;
            const saldo = income - expense;

            // Registrou algum valor HOJE?
            const { rows: todayRows } = await db.execute({
              sql: `SELECT 1 FROM transactions WHERE user_id=? AND created_at >= ? LIMIT 1`,
              args: [u.user_id, dayStartUtc],
            });
            const registrouHoje = rowsToObjects(todayRows).length > 0;

            const nome = (u.name || '').trim().split(/\s+/)[0] || '';
            const saldoIcon = saldo >= 0 ? '🟢' : '🔴';
            let text =
              `📊 *Resumo de ${nomeMes}*${nome ? ', ' + nome : ''}!\n\n` +
              `💰 Receitas: *${brl(income)}*\n` +
              `💸 Despesas: *${brl(expense)}*\n` +
              `${saldoIcon} Saldo do mês: *${brl(saldo)}*`;

            if (registrouHoje) {
              text += `\n\nSe teve mais algum gasto ou recebimento hoje, é só me mandar que eu registro na hora. 😉`;
            } else {
              text += `\n\n👋 Passando pra lembrar que estou por aqui pra te ajudar na sua gestão financeira! Você ainda não registrou nada hoje — se teve algum gasto ou recebimento, me envie por aqui que eu cuido do resto. 💪`;
            }

            let ok = false, errMsg = '';
            try {
              const sr = await evo.sendText({ name: dsInst.name, key: dsInst.api_key || null, number: (u.phone || '').replace(/\D/g, ''), text });
              ok = !!sr.ok;
              if (!ok) errMsg = evo.parseEvoError(sr?.data, sr?.status);
            } catch (e) { errMsg = e.message || 'erro'; }

            // Marca o envio (sucesso ou falha) para não reprocessar no mesmo dia.
            await db.execute({
              sql: `INSERT INTO notification_rule_sends (id, rule_id, user_id, channel, status, error, sent_at)
                    VALUES (?, 'daily_summary', ?, 'whatsapp', ?, ?, ?)`,
              args: [crypto.randomUUID(), u.user_id, ok ? 'sent' : 'failed', errMsg, new Date().toISOString()],
            });
            if (ok) dailySummarySends++;
          }
        }
      }
    } catch (blockEErr) {
      console.error('[dispatcher] daily_summary block error', blockEErr && blockEErr.message);
    }

    // ===================================================================
    // BLOCK F — lembrete diário de contas a pagar (8h BRT)
    // ===================================================================
    // Todo dia, às 8h (horário de Brasília), avisamos o usuário sobre as contas
    // que VENCEM HOJE: despesas pendentes (status='pending') com vencimento na
    // data de hoje + parcelas de parcelamentos cujo dia de vencimento é hoje. Se
    // não houver nenhuma, mandamos um "bom dia" avisando que não há contas.
    // Dedupe: 1 envio por dia por usuário (marca em notification_rule_sends com
    // rule_id='daily_bills'). Opt-out via user_notification_prefs 'daily_bills'.
    let dailyBillsSends = 0;
    try {
      const nowBRT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
      const hourBRT = nowBRT.getHours();

      if (hourBRT === 8) {
        const yBRT = nowBRT.getFullYear();
        const mBRT = nowBRT.getMonth() + 1;
        const dBRT = nowBRT.getDate();
        const pad = (n) => String(n).padStart(2, '0');
        const todayISO = `${yBRT}-${pad(mBRT)}-${pad(dBRT)}`;
        // Início do dia BRT (00:00) expresso em UTC = 03:00Z da mesma data.
        const dayStartUtc = new Date(Date.UTC(yBRT, mBRT - 1, dBRT, 3, 0, 0)).toISOString();
        const brl = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // Instância padrão conectada (canal WhatsApp).
        const { rows: dbInstRows } = await db.execute("SELECT name, api_key, connection_status FROM evolution_instances WHERE is_default=1 LIMIT 1");
        const dbInst = rowsToObjects(dbInstRows)[0] || null;

        if (dbInst && dbInst.connection_status === 'connected') {
          // Usuários elegíveis: plano ativo + telefone. O lembrete de contas vale
          // para os modos daily e bills_only; off/weekly/biweekly são excluídos.
          const { rows: dbUserRows } = await db.execute({
            sql: `SELECT u.id AS user_id, u.name, u.phone
                  FROM users u
                  JOIN user_plans p ON p.user_id = u.id
                  LEFT JOIN user_notification_prefs np
                         ON np.user_id = u.id AND np.notif_key = 'wa_notify'
                  WHERE p.active = 1
                    AND u.phone IS NOT NULL AND u.phone != ''
                    AND (np.value IS NULL OR np.value IN ('daily','bills_only'))
                  LIMIT 500`,
          });
          const dbUsers = rowsToObjects(dbUserRows);
          const DB_MAX = 200;

          for (const u of dbUsers) {
            if (dailyBillsSends >= DB_MAX) break;

            // Dedupe: já enviou hoje?
            const { rows: dupRows } = await db.execute({
              sql: `SELECT 1 FROM notification_rule_sends
                    WHERE rule_id='daily_bills' AND user_id=? AND sent_at >= ? LIMIT 1`,
              args: [u.user_id, dayStartUtc],
            });
            if (rowsToObjects(dupRows).length > 0) continue;

            // Despesas pendentes que vencem hoje.
            const { rows: billRows } = await db.execute({
              sql: `SELECT t.name, t.amount, c.name AS cat_name, a.name AS acc_name
                    FROM transactions t
                    LEFT JOIN categories c ON c.id = t.category_id
                    LEFT JOIN accounts a ON a.id = t.account_id
                    WHERE t.user_id=? AND t.transaction_type='expense'
                      AND t.status='pending' AND substr(t.due_date,1,10)=?`,
              args: [u.user_id, todayISO],
            });
            const bills = rowsToObjects(billRows).map((b) => ({
              name: b.name, amount: Number(b.amount) || 0,
              cat: b.cat_name || '', acc: b.acc_name || '',
            }));

            // Parcelas de parcelamentos cujo dia de vencimento é hoje.
            const { rows: instRows2 } = await db.execute({
              sql: `SELECT i.name, i.total_amount, i.installments, i.paid_installments,
                           i.due_day, i.start_month, i.start_year, i.created_at,
                           c.name AS cat_name, a.name AS acc_name
                    FROM installments i
                    LEFT JOIN categories c ON c.id = i.category_id
                    LEFT JOIN accounts a ON a.id = i.account_id
                    WHERE i.user_id=? AND i.paid_installments < i.installments
                      AND i.due_day = ?`,
              args: [u.user_id, dBRT],
            });
            for (const it of rowsToObjects(instRows2)) {
              const total = Number(it.installments) || 1;
              // Mês/ano da primeira parcela (fallback = created_at).
              let sm = Number(it.start_month), sy = Number(it.start_year);
              if (!sm || !sy) {
                const rawCr = String(it.created_at || '');
                const cr = new Date(/[TZ]/.test(rawCr) ? rawCr : rawCr.replace(' ', 'T') + 'Z');
                if (!isNaN(cr.getTime())) { sm = cr.getUTCMonth() + 1; sy = cr.getUTCFullYear(); }
              }
              if (!sm || !sy) continue;
              const monthsElapsed = (yBRT - sy) * 12 + (mBRT - sm);
              if (monthsElapsed < 0 || monthsElapsed >= total) continue; // fora do período do parcelamento
              const parcelaNum = monthsElapsed + 1;
              if (parcelaNum <= Number(it.paid_installments)) continue;   // parcela já paga
              const parcelaValor = (Number(it.total_amount) || 0) / total;
              bills.push({
                name: `${it.name} (parcela ${parcelaNum}/${total})`,
                amount: parcelaValor,
                cat: it.cat_name || '', acc: it.acc_name || '',
              });
            }

            const nome = (u.name || '').trim().split(/\s+/)[0] || '';
            let text;
            if (bills.length === 0) {
              text = `Bom dia${nome ? ', ' + nome : ''}! ☀️\n\nHoje você não tem nenhuma conta a pagar lançada. Tenha um ótimo dia! 🎉`;
            } else {
              const totalDia = bills.reduce((s, b) => s + b.amount, 0);
              const linhas = bills.map((b, i) => {
                let l = `*${i + 1}.* ${b.name} — *${brl(b.amount)}*`;
                const extra = [b.cat, b.acc].filter(Boolean).join(' · ');
                if (extra) l += `\n   _${extra}_`;
                return l;
              }).join('\n');
              text =
                `Bom dia${nome ? ', ' + nome : ''}! ☀️\n\n` +
                `Hoje você tem *${bills.length}* conta${bills.length > 1 ? 's' : ''} a pagar:\n\n` +
                `${linhas}\n\n` +
                `💰 *Total do dia:* ${brl(totalDia)}\n\n` +
                `Se você já pagou alguma dessas, me avise qual, a data e o valor que eu dou baixa por aqui. 😉`;
            }

            let ok = false, errMsg = '';
            try {
              const sr = await evo.sendText({ name: dbInst.name, key: dbInst.api_key || null, number: (u.phone || '').replace(/\D/g, ''), text });
              ok = !!sr.ok;
              if (!ok) errMsg = evo.parseEvoError(sr?.data, sr?.status);
            } catch (e) { errMsg = e.message || 'erro'; }

            // Marca o envio (sucesso ou falha) para não reprocessar no mesmo dia.
            await db.execute({
              sql: `INSERT INTO notification_rule_sends (id, rule_id, user_id, channel, status, error, sent_at)
                    VALUES (?, 'daily_bills', ?, 'whatsapp', ?, ?, ?)`,
              args: [crypto.randomUUID(), u.user_id, ok ? 'sent' : 'failed', errMsg, new Date().toISOString()],
            });
            if (ok) dailyBillsSends++;
          }
        }
      }
    } catch (blockFErr) {
      console.error('[dispatcher] daily_bills block error', blockFErr && blockFErr.message);
    }

    return res.status(200).json({
      ok: true,
      whatsapp: processed.length,
      email: emailProcessed.length,
      plan_reminders: reminderCount,
      rule_sends: ruleSends,
      followup_sends: followupSends,
      daily_summary_sends: dailySummarySends,
      daily_bills_sends: dailyBillsSends,
      processed: processed.length,
      details: processed,
    });
  } catch (err) {
    console.error('[dispatcher]', err);
    return res.status(500).json({ error: err.message });
  }
}
