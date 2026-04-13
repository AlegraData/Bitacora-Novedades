/**
 * EmailService - Automatización de correos desde campos tipo "botón"
 * ==================================================================
 * Flujo:
 *   1. El usuario configura un campo de tipo "button" con:
 *      - campo_destino: ID del campo que contiene los correos
 *      - asunto:        Texto con placeholders {{NombreCampo}}
 *      - cuerpo:        Texto/HTML con placeholders {{NombreCampo}}
 *   2. Al hacer clic, se llama triggerButtonEmail(recordId, buttonFieldId)
 *   3. Se obtienen los correos del campo destino del registro
 *   4. Se reemplazan los placeholders con los valores del registro
 *   5. Se envía el correo via GmailApp
 *
 * Scope requerido:
 *   https://www.googleapis.com/auth/gmail.send
 */

var EmailService = {

  /**
   * Envía el correo configurado en un campo botón para un registro específico.
   * @param {string} recordId      - ID del registro
   * @param {string} buttonFieldId - ID del campo tipo "button"
   * @returns {{ emails: string[], subject: string }}
   */
  sendForRecord: function(recordId, buttonFieldId) {
    Logger.log('[EmailService.sendForRecord] recordId: %s | buttonFieldId: %s', recordId, buttonFieldId);

    // Obtener el registro
    var allRecords = SheetsService.getRecords({});
    var record = null;
    for (var i = 0; i < allRecords.length; i++) {
      if (allRecords[i].id === recordId) { record = allRecords[i]; break; }
    }
    if (!record) {
      Logger.log('[EmailService.sendForRecord] ERROR: Registro no encontrado: %s', recordId);
      throw new Error('Registro no encontrado: ' + recordId);
    }
    Logger.log('[EmailService.sendForRecord] Registro encontrado OK');

    // Obtener configuración del campo botón
    var fields      = SheetsService.getFields();
    var buttonField = null;
    for (var j = 0; j < fields.length; j++) {
      if (fields[j].id === buttonFieldId) { buttonField = fields[j]; break; }
    }
    if (!buttonField || buttonField.tipo !== 'button') {
      throw new Error('Campo botón no encontrado: ' + buttonFieldId);
    }

    var config = buttonField.config_boton;
    if (!config || config.accion !== 'enviar_correo') {
      throw new Error('El botón no tiene configurada la acción "enviar_correo".');
    }

    // Obtener correos del campo destino
    var emailValue = record[config.campo_destino] || '';
    if (!emailValue) {
      throw new Error('El campo "' + config.campo_destino + '" del registro está vacío.');
    }

    var emails = String(emailValue)
      .split(/[,;\n]/)
      .map(function(e) { return e.trim(); })
      .filter(function(e) { return e && e.indexOf('@') !== -1; });

    if (emails.length === 0) {
      throw new Error('No se encontraron correos válidos en el campo destino.');
    }

    // Construir asunto y cuerpo reemplazando {{NombreCampo}}
    var subject = this._fillTemplate(config.asunto || 'Notificación', record, fields);
    var body    = this._fillTemplate(config.cuerpo || '', record, fields);

    var sender = Session.getActiveUser().getEmail();

    Logger.log('[EmailService.sendForRecord] Enviando a %s destinatarios: %s', emails.length, emails.join(', '));
    Logger.log('[EmailService.sendForRecord] Asunto: %s', subject);

    // Enviar a cada destinatario
    emails.forEach(function(email) {
      Logger.log('[EmailService.sendForRecord] Enviando a: %s', email);
      GmailApp.sendEmail(email, subject, body, {
        htmlBody:  EmailService._buildHtml(subject, body, record, fields),
        replyTo:   sender,
        name:      'Bitácora Novedades Product'
      });
      Logger.log('[EmailService.sendForRecord] Correo enviado a: %s', email);
    });

    // Registrar envío en el campo de log (si existe)
    if (config.campo_log) {
      var logValue = record[config.campo_log] || '';
      var now      = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
      record[config.campo_log] = logValue
        ? logValue + '\n' + now + ' → ' + emails.join(', ')
        : now + ' → ' + emails.join(', ');

      var user = getCurrentUser();
      SheetsService.saveRecord(record, user);
    }

    return { emails: emails, subject: subject };
  },

  /**
   * Reemplaza {{NombreCampo}} con el valor real del registro.
   * Soporta tanto nombre de campo como ID de campo.
   */
  _fillTemplate: function(template, record, fields) {
    var result = template;
    fields.forEach(function(field) {
      var value = record[field.id] !== undefined ? String(record[field.id]) : '';
      // Por nombre
      result = result.replace(
        new RegExp('\\{\\{' + field.nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\}\\}', 'gi'),
        value
      );
      // Por ID
      result = result.replace(
        new RegExp('\\{\\{' + field.id + '\\}\\}', 'gi'),
        value
      );
    });
    return result;
  },

  /** Construye el cuerpo HTML del correo con la plantilla de marca Alegra */
  _buildHtml: function(subject, body, record, fields) {
    var rows = '';
    fields.forEach(function(field) {
      if (!field.visible || field.tipo === 'button') return;
      var val = record[field.id];
      if (val === undefined || val === null || val === '') return;
      rows += '<tr>'
        + '<td style="padding:6px 12px;color:#718096;font-size:13px;width:140px;vertical-align:top;">'
        + field.nombre + '</td>'
        + '<td style="padding:6px 12px;color:#2d3748;font-size:13px;">'
        + String(val).replace(/\n/g, '<br>') + '</td>'
        + '</tr>';
    });

    return '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f7fa;">'
      + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:32px 0;">'
      + '<tr><td align="center">'
      + '<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">'

      // Header
      + '<tr><td style="background:#1e2a3a;padding:20px 28px;">'
      + '<p style="margin:0;color:#00C4A0;font-size:11px;font-family:Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;">Alegra · Bitácora</p>'
      + '<h2 style="margin:4px 0 0;color:#ffffff;font-family:Arial,sans-serif;font-size:18px;">Bitácora Novedades Product</h2>'
      + '</td></tr>'

      // Subject
      + '<tr><td style="padding:24px 28px 8px;border-bottom:1px solid #e2e8f0;">'
      + '<h3 style="margin:0;color:#1a202c;font-family:Arial,sans-serif;font-size:20px;">' + subject + '</h3>'
      + '</td></tr>'

      // Body
      + (body ? '<tr><td style="padding:16px 28px;color:#4a5568;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;">'
        + body.replace(/\n/g, '<br>') + '</td></tr>' : '')

      // Detalle del registro
      + (rows ? '<tr><td style="padding:8px 28px 24px;">'
        + '<p style="margin:0 0 8px;color:#a0aec0;font-size:11px;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;">Detalles del registro</p>'
        + '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">'
        + rows + '</table></td></tr>' : '')

      // Footer
      + '<tr><td style="background:#f7fafc;padding:16px 28px;border-top:1px solid #e2e8f0;">'
      + '<p style="margin:0;color:#a0aec0;font-size:12px;font-family:Arial,sans-serif;">Enviado automáticamente desde Bitácora Novedades Product · Alegra</p>'
      + '</td></tr>'

      + '</table></td></tr></table></body></html>';
  }
};
