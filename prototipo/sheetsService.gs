/**
 * SheetsService - Operaciones CRUD sobre Google Sheets
 * ======================================================
 * Estructura de hojas:
 *   Registros      - Datos dinámicos (columnas = ids de campos)
 *   _campos        - Definición de campos del formulario
 *   _etiquetas     - Opciones de etiquetas por campo
 *   _auditoria     - Log de acciones de usuarios
 *   _usuarios_cache - Caché de usuarios del workspace
 */

var SheetsService = {

  SHEETS: {
    RECORDS:     'Registros',
    FIELDS:      '_campos',
    TAGS:        '_etiquetas',
    AUDIT:       '_auditoria',
    USERS_CACHE: '_usuarios_cache'
  },

  // ---------- SPREADSHEET ----------

  getSpreadsheet: function() {
    var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  },

  // ---------- INIT ----------

  initSheets: function() {
    Logger.log('[SheetsService.initSheets] Verificando hojas...');
    var ss = this.getSpreadsheet();
    Logger.log('[SheetsService.initSheets] Spreadsheet: %s', ss.getName());

    // _campos
    if (!ss.getSheetByName(this.SHEETS.FIELDS)) {
      var fs = ss.insertSheet(this.SHEETS.FIELDS);
      fs.getRange(1, 1, 1, 8).setValues([[
        'id', 'nombre', 'tipo', 'opciones', 'orden', 'filtrable', 'visible', 'config_boton'
      ]]);
      fs.setColumnWidth(1, 160);
      fs.hideSheet();
    }

    // _etiquetas
    if (!ss.getSheetByName(this.SHEETS.TAGS)) {
      var ts = ss.insertSheet(this.SHEETS.TAGS);
      ts.getRange(1, 1, 1, 5).setValues([['id', 'campo_id', 'nombre', 'color', 'orden']]);
      ts.hideSheet();
    }

    // _auditoria
    if (!ss.getSheetByName(this.SHEETS.AUDIT)) {
      var as = ss.insertSheet(this.SHEETS.AUDIT);
      as.getRange(1, 1, 1, 6).setValues([[
        'timestamp', 'usuario_email', 'usuario_nombre', 'accion', 'registro_id', 'detalles'
      ]]);
      as.hideSheet();
    }

    Logger.log('[SheetsService.initSheets] Todas las hojas verificadas/creadas OK');
    // Registros
    if (!ss.getSheetByName(this.SHEETS.RECORDS)) {
      var rs = ss.insertSheet(this.SHEETS.RECORDS);
      rs.getRange(1, 1, 1, 5).setValues([[
        'id', 'created_at', 'created_by_email', 'created_by_name', 'updated_at'
      ]]);
      // Congelar primera fila y primera columna
      rs.setFrozenRows(1);
      rs.setFrozenColumns(1);
      // Formato de encabezado
      rs.getRange(1, 1, 1, 5)
        .setBackground('#1e2a3a')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
    }
  },

  // ---------- CAMPOS ----------

  getFields: function() {
    Logger.log('[SheetsService.getFields] Leyendo campos...');
    var ss  = this.getSpreadsheet();
    var sh  = ss.getSheetByName(this.SHEETS.FIELDS);
    if (!sh || sh.getLastRow() < 2) {
      Logger.log('[SheetsService.getFields] Hoja vacía o inexistente, devolviendo []');
      return [];
    }

    var data = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
    return data
      .filter(function(r) { return r[0]; })
      .map(function(r) {
        return {
          id:           r[0],
          nombre:       r[1],
          tipo:         r[2],
          opciones:     r[3] ? JSON.parse(r[3]) : [],
          orden:        Number(r[4]) || 0,
          filtrable:    r[5] === true || r[5] === 'true',
          visible:      r[6] === true || r[6] === 'true' || r[6] === '',
          config_boton: r[7] ? JSON.parse(r[7]) : null
        };
      })
      .sort(function(a, b) { return a.orden - b.orden; });
  },

  saveField: function(fieldData) {
    Logger.log('[SheetsService.saveField] %s "%s" (tipo: %s)', fieldData.id ? 'Actualizando' : 'Creando', fieldData.nombre, fieldData.tipo);
    var ss  = this.getSpreadsheet();
    var sh  = ss.getSheetByName(this.SHEETS.FIELDS);
    var isNew = !fieldData.id;

    if (isNew) {
      fieldData.id    = 'f_' + Date.now();
      var existing    = this.getFields();
      fieldData.orden = existing.length > 0
        ? Math.max.apply(null, existing.map(function(f) { return f.orden; })) + 1
        : 1;
    }

    if (fieldData.visible === undefined) fieldData.visible = true;

    var row = [
      fieldData.id,
      fieldData.nombre,
      fieldData.tipo,
      JSON.stringify(fieldData.opciones || []),
      fieldData.orden,
      fieldData.filtrable  || false,
      fieldData.visible,
      fieldData.config_boton ? JSON.stringify(fieldData.config_boton) : ''
    ];

    if (isNew) {
      sh.appendRow(row);
      // Agregar columna en hoja Registros
      var rs    = ss.getSheetByName(this.SHEETS.RECORDS);
      if (rs) {
        var lastCol = rs.getLastColumn() + 1;
        rs.getRange(1, lastCol).setValue(fieldData.id)
          .setBackground('#1e2a3a').setFontColor('#ffffff').setFontWeight('bold');
      }
    } else {
      var data = sh.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === fieldData.id) {
          sh.getRange(i + 1, 1, 1, 8).setValues([row]);
          break;
        }
      }
    }

    return fieldData;
  },

  deleteField: function(fieldId) {
    var ss = this.getSpreadsheet();
    var sh = ss.getSheetByName(this.SHEETS.FIELDS);
    var data = sh.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === fieldId) {
        sh.deleteRow(i + 1);
        break;
      }
    }

    // Marcar columna como eliminada en Registros (no borra datos)
    var rs = ss.getSheetByName(this.SHEETS.RECORDS);
    if (rs && rs.getLastColumn() > 0) {
      var headers = rs.getRange(1, 1, 1, rs.getLastColumn()).getValues()[0];
      var colIdx  = headers.indexOf(fieldId);
      if (colIdx !== -1) {
        rs.getRange(1, colIdx + 1).setValue('_deleted_' + fieldId);
      }
    }
  },

  reorderFields: function(orderedIds) {
    var self   = this;
    var fields = this.getFields();
    orderedIds.forEach(function(id, index) {
      var field = fields.filter(function(f) { return f.id === id; })[0];
      if (field) {
        field.orden = index + 1;
        self.saveField(field);
      }
    });
  },

  // ---------- ETIQUETAS ----------

  getTags: function(fieldId) {
    var ss  = this.getSpreadsheet();
    var sh  = ss.getSheetByName(this.SHEETS.TAGS);
    if (!sh || sh.getLastRow() < 2) return [];

    var data = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
    return data
      .filter(function(r) { return r[0] && (!fieldId || r[1] === fieldId); })
      .map(function(r) {
        return { id: r[0], campo_id: r[1], nombre: r[2], color: r[3], orden: Number(r[4]) || 0 };
      })
      .sort(function(a, b) { return a.orden - b.orden; });
  },

  saveTag: function(tagData) {
    var ss    = this.getSpreadsheet();
    var sh    = ss.getSheetByName(this.SHEETS.TAGS);
    var isNew = !tagData.id;

    if (isNew) {
      tagData.id    = 't_' + Date.now();
      var existing  = this.getTags(tagData.campo_id);
      tagData.orden = existing.length + 1;
    }

    var row = [tagData.id, tagData.campo_id, tagData.nombre, tagData.color || '#718096', tagData.orden];

    if (isNew) {
      sh.appendRow(row);
    } else {
      var data = sh.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === tagData.id) {
          sh.getRange(i + 1, 1, 1, 5).setValues([row]);
          break;
        }
      }
    }
    return tagData;
  },

  deleteTag: function(tagId) {
    var ss   = this.getSpreadsheet();
    var sh   = ss.getSheetByName(this.SHEETS.TAGS);
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === tagId) { sh.deleteRow(i + 1); break; }
    }
  },

  // ---------- REGISTROS ----------

  getRecords: function(filters) {
    Logger.log('[SheetsService.getRecords] Filtros: %s', JSON.stringify(filters || {}));
    var ss = this.getSpreadsheet();
    var sh = ss.getSheetByName(this.SHEETS.RECORDS);
    if (!sh || sh.getLastRow() < 2) {
      Logger.log('[SheetsService.getRecords] Sin registros.');
      return [];
    }

    var lastCol = sh.getLastColumn();
    var lastRow = sh.getLastRow();
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var data    = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

    var records = data
      .filter(function(row) { return row[0]; })
      .map(function(row) {
        var rec = {};
        headers.forEach(function(h, i) {
          if (h && h.toString().indexOf('_deleted_') === -1) {
            var val = row[i];
            // Convertir objetos Date a string ISO para evitar errores de serialización en google.script.run
            rec[h] = val instanceof Date ? val.toISOString() : val;
          }
        });
        return rec;
      });

    // Filtros
    if (filters) {
      // Búsqueda de texto
      if (filters.search) {
        var q = filters.search.toLowerCase();
        records = records.filter(function(r) {
          return Object.values(r).some(function(v) {
            return String(v).toLowerCase().indexOf(q) !== -1;
          });
        });
      }

      // Filtro por campo + valor (etiqueta/selección)
      if (filters.fieldId && filters.value !== undefined && filters.value !== '') {
        records = records.filter(function(r) {
          var val = String(r[filters.fieldId] || '');
          if (Array.isArray(filters.value)) {
            return filters.value.some(function(v) { return val.indexOf(v) !== -1; });
          }
          return val.toLowerCase().indexOf(String(filters.value).toLowerCase()) !== -1;
        });
      }

      // Filtro por rango de fechas
      if (filters.dateFrom && filters.dateTo && filters.dateFieldId) {
        var from = new Date(filters.dateFrom);
        var to   = new Date(filters.dateTo);
        records = records.filter(function(r) {
          var d = new Date(r[filters.dateFieldId]);
          return !isNaN(d) && d >= from && d <= to;
        });
      }
    }

    return records.sort(function(a, b) {
      return new Date(b.created_at) - new Date(a.created_at);
    });
  },

  saveRecord: function(recordData, user) {
    Logger.log('[SheetsService.saveRecord] %s | por: %s', recordData.id ? 'UPDATE '+recordData.id : 'INSERT', user.email);
    var ss      = this.getSpreadsheet();
    var sh      = ss.getSheetByName(this.SHEETS.RECORDS);
    var lastCol = sh.getLastColumn();
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var isNew   = !recordData.id;
    var now     = new Date().toISOString();

    if (isNew) {
      recordData.id               = 'r_' + Date.now();
      recordData.created_at       = now;
      recordData.created_by_email = user.email;
      recordData.created_by_name  = user.name;
    }
    recordData.updated_at = now;

    var row = headers.map(function(h) {
      if (!h || h.toString().indexOf('_deleted_') !== -1) return '';
      return recordData[h] !== undefined ? recordData[h] : '';
    });

    if (isNew) {
      sh.appendRow(row);
    } else {
      var ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
      for (var i = 1; i < ids.length; i++) {
        if (ids[i][0] === recordData.id) {
          sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
          break;
        }
      }
    }

    return recordData;
  },

  deleteRecord: function(recordId) {
    var ss  = this.getSpreadsheet();
    var sh  = ss.getSheetByName(this.SHEETS.RECORDS);
    var ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
    for (var i = 1; i < ids.length; i++) {
      if (ids[i][0] === recordId) { sh.deleteRow(i + 1); break; }
    }
  },

  // ---------- AUDITORÍA ----------

  addAuditLog: function(email, name, action, recordId, details) {
    Logger.log('[SheetsService.addAuditLog] %s | usuario: %s | recordId: %s', action, email, recordId || '-');
    var ss = this.getSpreadsheet();
    var sh = ss.getSheetByName(this.SHEETS.AUDIT);
    if (sh) {
      sh.appendRow([new Date().toISOString(), email, name, action, recordId || '', details || '']);
    }
  },

  getAuditLog: function(limit) {
    var ss = this.getSpreadsheet();
    var sh = ss.getSheetByName(this.SHEETS.AUDIT);
    if (!sh || sh.getLastRow() < 2) return [];

    var lastRow  = sh.getLastRow();
    var startRow = Math.max(2, lastRow - limit + 1);
    var count    = lastRow - startRow + 1;
    var data     = sh.getRange(startRow, 1, count, 6).getValues();

    return data.reverse().map(function(r) {
      return {
        timestamp:      r[0],
        usuario_email:  r[1],
        usuario_nombre: r[2],
        accion:         r[3],
        registro_id:    r[4],
        detalles:       r[5]
      };
    });
  }
};
