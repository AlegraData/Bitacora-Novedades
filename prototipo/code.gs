/**
 * Bitácora Novedades Product | New Version
 * ==========================================
 * Archivo principal - Google Apps Script
 *
 * SCOPES requeridos (ver appsscript.json):
 *   - spreadsheets
 *   - gmail.send
 *   - directory.readonly  (People API)
 *   - userinfo.email
 *   - userinfo.profile
 */

// ---------- ROUTING ----------

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'index';
  console.log('[doGet] Página solicitada:', page, '| usuario:', Session.getActiveUser().getEmail());
  Logger.log('[doGet] page=%s', page);

  try {
    var template = (page === 'app')
      ? HtmlService.createTemplateFromFile('App')
      : HtmlService.createTemplateFromFile('Index');

    var output = template.evaluate()
      .setTitle('Bitácora Novedades Product | New Version')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

    console.log('[doGet] Página servida correctamente:', page);
    return output;
  } catch (err) {
    console.error('[doGet] Error al servir página:', err.message, err.stack);
    Logger.log('[doGet] ERROR: %s', err.message);
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:40px;max-width:600px;margin:40px auto;'
      + 'background:#fff5f5;border:1px solid #fc8181;border-radius:8px">'
      + '<h2 style="color:#c53030">Error al cargar la página</h2>'
      + '<p style="color:#742a2a;font-family:monospace;white-space:pre-wrap">' + err.message + '</p>'
      + '<p style="color:#742a2a;font-size:12px;font-family:monospace;white-space:pre-wrap">' + (err.stack || '') + '</p>'
      + '</div>'
    );
  }
}

/** Permite <?= include('NombreArchivo') ?> en las plantillas HTML */
function include(filename) {
  Logger.log('[include] archivo: %s', filename);
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ---------- USUARIO ACTUAL ----------

function getCurrentUser() {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail();
    Logger.log('[getCurrentUser] email: %s', email);
    if (!email) {
      Logger.log('[getCurrentUser] No se pudo obtener el email de sesión.');
      return { email: 'desconocido', name: 'Usuario', photo: null };
    }

    // Intento 1: People API — búsqueda por email en el directorio (evita el problema de 'people/me' que devuelve el dueño del script)
    try {
      var _peopleApi = (typeof People !== 'undefined') ? People : (typeof Peopleapi !== 'undefined' ? Peopleapi : PeopleAPI);
      var searchResult = _peopleApi.People.searchDirectoryPeople({
        query: email,
        readMask: 'names,emailAddresses,photos',
        sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'],
        pageSize: 5
      });
      if (searchResult.people && searchResult.people.length > 0) {
        var match = searchResult.people.filter(function(p) {
          return p.emailAddresses && p.emailAddresses.some(function(e) { return e.value === email; });
        })[0];
        if (match) {
          var name  = (match.names && match.names[0]) ? match.names[0].displayName : null;
          var photo = (match.photos && match.photos[0]) ? match.photos[0].url : null;
          Logger.log('[getCurrentUser] People API (directorio) OK — nombre: %s | foto: %s', name, photo ? 'sí' : 'no');
          if (name) return { email: email, name: name, photo: photo };
        }
      }
      Logger.log('[getCurrentUser] People API (directorio) no encontró coincidencia para: %s', email);
    } catch (e1) {
      Logger.log('[getCurrentUser] People API falló: %s', e1.message);
    }

    // Intento 2: buscar en el directorio del workspace
    try {
      var dirResult = UsersService.getAll();
      if (dirResult.success && dirResult.data.length > 0) {
        var match = dirResult.data.filter(function(u) { return u.email === email; })[0];
        if (match) {
          Logger.log('[getCurrentUser] Encontrado en directorio: %s | foto: %s', match.name, match.photo ? 'sí' : 'no');
          return { email: email, name: match.name, photo: match.photo || null };
        }
      }
      Logger.log('[getCurrentUser] No encontrado en directorio.');
    } catch (e2) {
      Logger.log('[getCurrentUser] Búsqueda en directorio falló: %s', e2.message);
    }

    // Fallback: usar prefijo del email
    var fallbackName = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    Logger.log('[getCurrentUser] Usando nombre fallback: %s', fallbackName);
    return { email: email, name: fallbackName, photo: null };

  } catch (e) {
    Logger.log('[getCurrentUser] Error general: %s', e.message);
    return { email: email || 'desconocido', name: 'Usuario', photo: null };
  }
}

// ---------- USUARIOS DEL WORKSPACE ----------

function getWorkspaceUsers() {
  Logger.log('[getWorkspaceUsers] Solicitando usuarios del workspace...');
  var result = UsersService.getAll();
  Logger.log('[getWorkspaceUsers] Resultado: %s usuarios | fuente: %s | error: %s',
    result.data ? result.data.length : 0, result.source || 'api', result.error || 'ninguno');
  return result;
}

// ---------- CAMPOS ----------

function getFields() {
  Logger.log('[getFields] Leyendo campos de la hoja...');
  try {
    var fields = SheetsService.getFields();
    Logger.log('[getFields] OK — %s campos encontrados', fields.length);
    return { success: true, data: fields };
  } catch (e) {
    Logger.log('[getFields] ERROR: %s', e.message);
    return { success: false, error: e.message, data: [] };
  }
}

function saveField(fieldData) {
  Logger.log('[saveField] Guardando campo: %s (tipo: %s, id: %s)', fieldData.nombre, fieldData.tipo, fieldData.id || 'NUEVO');
  try {
    var result = SheetsService.saveField(fieldData);
    Logger.log('[saveField] OK — id asignado: %s', result.id);
    _logAudit('campo_guardado', null, JSON.stringify({ id: fieldData.id, nombre: fieldData.nombre }));
    return { success: true, data: result };
  } catch (e) {
    Logger.log('[saveField] ERROR: %s', e.message);
    return { success: false, error: e.message };
  }
}

function deleteField(fieldId) {
  Logger.log('[deleteField] Eliminando campo: %s', fieldId);
  try {
    SheetsService.deleteField(fieldId);
    Logger.log('[deleteField] OK');
    _logAudit('campo_eliminado', null, fieldId);
    return { success: true };
  } catch (e) {
    Logger.log('[deleteField] ERROR: %s', e.message);
    return { success: false, error: e.message };
  }
}

function reorderFields(orderedIds) {
  Logger.log('[reorderFields] Reordenando %s campos', orderedIds.length);
  try {
    SheetsService.reorderFields(orderedIds);
    Logger.log('[reorderFields] OK');
    return { success: true };
  } catch (e) {
    Logger.log('[reorderFields] ERROR: %s', e.message);
    return { success: false, error: e.message };
  }
}

// ---------- ETIQUETAS ----------

function getTags(fieldId) {
  Logger.log('[getTags] Leyendo etiquetas del campo: %s', fieldId);
  try {
    var tags = SheetsService.getTags(fieldId);
    Logger.log('[getTags] OK — %s etiquetas', tags.length);
    return { success: true, data: tags };
  } catch (e) {
    Logger.log('[getTags] ERROR: %s', e.message);
    return { success: false, error: e.message, data: [] };
  }
}

function saveTag(tagData) {
  Logger.log('[saveTag] Guardando etiqueta: %s (campo: %s, id: %s)', tagData.nombre, tagData.campo_id, tagData.id || 'NUEVA');
  try {
    var result = SheetsService.saveTag(tagData);
    Logger.log('[saveTag] OK — id: %s', result.id);
    return { success: true, data: result };
  } catch (e) {
    Logger.log('[saveTag] ERROR: %s', e.message);
    return { success: false, error: e.message };
  }
}

function deleteTag(tagId) {
  Logger.log('[deleteTag] Eliminando etiqueta: %s', tagId);
  try {
    SheetsService.deleteTag(tagId);
    Logger.log('[deleteTag] OK');
    return { success: true };
  } catch (e) {
    Logger.log('[deleteTag] ERROR: %s', e.message);
    return { success: false, error: e.message };
  }
}

// ---------- REGISTROS ----------

function getRecords(filters) {
  Logger.log('[getRecords] Filtros: %s', JSON.stringify(filters || {}));
  try {
    var data = SheetsService.getRecords(filters || {});
    Logger.log('[getRecords] OK — %s registros devueltos', data.length);
    return { success: true, data: data };
  } catch (e) {
    Logger.log('[getRecords] ERROR: %s', e.message || String(e));
    return { success: false, error: e.message || String(e) || 'Error interno en getRecords', data: [] };
  }
}

function saveRecord(recordData) {
  var isNew = !recordData.id;
  Logger.log('[saveRecord] %s registro. id: %s', isNew ? 'CREANDO' : 'ACTUALIZANDO', recordData.id || '(nuevo)');
  try {
    var user   = getCurrentUser();
    var result = SheetsService.saveRecord(recordData, user);
    var action = isNew ? 'registro_creado' : 'registro_actualizado';
    Logger.log('[saveRecord] OK — id final: %s | por: %s', result.id, user.email);
    _logAudit(action, result.id, result.id);
    return { success: true, data: result };
  } catch (e) {
    Logger.log('[saveRecord] ERROR: %s | stack: %s', e.message, e.stack);
    return { success: false, error: e.message };
  }
}

function deleteRecord(recordId) {
  Logger.log('[deleteRecord] Eliminando registro: %s', recordId);
  try {
    SheetsService.deleteRecord(recordId);
    Logger.log('[deleteRecord] OK');
    _logAudit('registro_eliminado', recordId, null);
    return { success: true };
  } catch (e) {
    Logger.log('[deleteRecord] ERROR: %s', e.message);
    return { success: false, error: e.message };
  }
}

// ---------- BOTÓN - ENVIAR CORREO ----------

function triggerButtonEmail(recordId, buttonFieldId) {
  Logger.log('[triggerButtonEmail] recordId: %s | fieldId: %s', recordId, buttonFieldId);
  try {
    var result = EmailService.sendForRecord(recordId, buttonFieldId);
    Logger.log('[triggerButtonEmail] OK — correos enviados a: %s', result.emails.join(', '));
    _logAudit('email_enviado', recordId, buttonFieldId);
    return { success: true, data: result };
  } catch (e) {
    Logger.log('[triggerButtonEmail] ERROR: %s', e.message);
    return { success: false, error: e.message };
  }
}

// ---------- STATS (para landing) ----------

function getStats() {
  Logger.log('[getStats] Calculando estadísticas...');
  try {
    var ss       = SheetsService.getSpreadsheet();
    var recSheet = ss.getSheetByName(SheetsService.SHEETS.RECORDS);
    var total    = recSheet ? Math.max(0, recSheet.getLastRow() - 1) : 0;
    var fields   = SheetsService.getFields();
    Logger.log('[getStats] OK — registros: %s | campos: %s', total, fields.length);
    return { success: true, data: { total: total, fields: fields.length } };
  } catch (e) {
    Logger.log('[getStats] ERROR: %s', e.message);
    return { success: false, error: e.message, data: { total: 0, fields: 0 } };
  }
}

// ---------- INICIALIZAR APP ----------

function initApp() {
  Logger.log('[initApp] Inicializando hojas de la aplicación...');
  try {
    SheetsService.initSheets();
    Logger.log('[initApp] OK — hojas verificadas/creadas');
    return { success: true };
  } catch (e) {
    Logger.log('[initApp] ERROR: %s | stack: %s', e.message, e.stack);
    return { success: false, error: e.message };
  }
}

// ---------- AUDITORÍA ----------

function getAuditLog(limit) {
  Logger.log('[getAuditLog] Solicitando últimos %s registros de auditoría', limit || 50);
  try {
    var logs = SheetsService.getAuditLog(limit || 50);
    Logger.log('[getAuditLog] OK — %s entradas', logs.length);
    return { success: true, data: logs };
  } catch (e) {
    Logger.log('[getAuditLog] ERROR: %s', e.message);
    return { success: false, error: e.message, data: [] };
  }
}

function _logAudit(action, recordId, details) {
  try {
    var user = getCurrentUser();
    Logger.log('[audit] %s | usuario: %s | id: %s', action, user.email, recordId || '-');
    SheetsService.addAuditLog(user.email, user.name, action, recordId, details);
  } catch (e) {
    Logger.log('[audit] Error al registrar auditoría: %s', e.message);
  }
}

// ---------- UTILIDADES ----------

function getAppUrl() {
  return ScriptApp.getService().getUrl();
}
