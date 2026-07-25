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
                   c.instance_name, c.created_by_id, c.created_by_name, c.created_by_email
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
          sql: `SELECT u.name, u.email, u.phone,
                       p.active AS plan_active, p.name AS plan_name
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

    return res.status(200).json({
      ok: true,
      whatsapp: processed.length,
      email: emailProcessed.length,
      plan_reminders: reminderCount,
      rule_sends: ruleSends,
      processed: processed.length,
      details: processed,
    });
  } catch (err) {
    console.error('[dispatcher]', err);
    return res.status(500).json({ error: err.message });
  }
}
