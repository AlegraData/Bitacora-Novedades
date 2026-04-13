/**
 * UsersService - Usuarios activos del Google Workspace
 * =====================================================
 * Usa People API (listDirectoryPeople) — no requiere rol de Admin.
 *
 * Scopes requeridos:
 *   https://www.googleapis.com/auth/directory.readonly
 *   https://www.googleapis.com/auth/contacts.readonly
 *
 * API a habilitar en Google Cloud:
 *   People API
 */

var UsersService = {

  CACHE_KEY: 'ws_users_v1',
  CACHE_SECONDS: 3600, // 1 hora

  /**
   * Retorna todos los usuarios activos del workspace.
   * Intenta: CacheService → People API → hoja _usuarios_cache
   */
  getAll: function () {
    Logger.log('[UsersService.getAll] Solicitando usuarios del workspace...');

    // 1. Cache en memoria (CacheService, máx 6 horas)
    var cache = CacheService.getScriptCache();
    var cached = cache.get(this.CACHE_KEY);
    if (cached) {
      var cacheData = JSON.parse(cached);
      Logger.log('[UsersService.getAll] Devolviendo desde CacheService: %s usuarios', cacheData.length);
      return { success: true, data: cacheData, source: 'cache' };
    }
    Logger.log('[UsersService.getAll] Cache miss — llamando People API...');

    // 2. People API
    try {
      var users = [];
      var pageToken = null;

      do {
        var params = {
          readMask: 'names,emailAddresses,photos,organizations',
          sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'],
          pageSize: 200
        };
        if (pageToken) params.pageToken = pageToken;
        var _peopleApi = (typeof People !== 'undefined') ? People : (typeof Peopleapi !== 'undefined' ? Peopleapi : PeopleAPI);
        var response = _peopleApi.People.listDirectoryPeople(params);

        if (response.people) {
          response.people.forEach(function (person) {
            var email = person.emailAddresses && person.emailAddresses[0]
              ? person.emailAddresses[0].value : null;
            var name = person.names && person.names[0]
              ? person.names[0].displayName : null;
            var photo = person.photos && person.photos[0]
              ? person.photos[0].url : null;
            var dept = person.organizations && person.organizations[0]
              ? person.organizations[0].department : null;

            if (email && name) {
              users.push({ email: email, name: name, photo: photo || null, department: dept || null });
            }
          });
        }

        pageToken = response.nextPageToken || null;
      } while (pageToken);

      Logger.log('[UsersService.getAll] People API OK — %s usuarios encontrados', users.length);
      // Ordenar por nombre
      users.sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); });

      // Guardar en CacheService
      if (users.length > 0) {
        try {
          // CacheService tiene límite de 100KB por clave
          var payload = JSON.stringify(users);
          if (payload.length < 90000) {
            cache.put(this.CACHE_KEY, payload, this.CACHE_SECONDS);
          }
        } catch (e) { /* ignorar error de cache */ }

        // Guardar en hoja para respaldo
        this._saveToSheetCache(users);
      }

      return { success: true, data: users, source: 'api' };

    } catch (apiError) {
      Logger.log('[UsersService.getAll] People API ERROR: %s', apiError.message);
      // 3. Fallback: hoja _usuarios_cache
      try {
        var sheetUsers = this._getFromSheetCache();
        if (sheetUsers.length > 0) {
          Logger.log('[UsersService.getAll] Fallback a hoja cache: %s usuarios', sheetUsers.length);
          return { success: true, data: sheetUsers, source: 'sheet_cache', warning: apiError.message };
        }
      } catch (e2) {
        Logger.log('[UsersService.getAll] Error leyendo hoja cache: %s', e2.message);
      }

      return {
        success: false,
        error: 'People API no disponible: ' + apiError.message
          + '. Verifica que la API esté habilitada y que tengas el scope correcto.',
        data: []
      };
    }
  },

  /** Fuerza recarga ignorando cache */
  refresh: function () {
    CacheService.getScriptCache().remove(this.CACHE_KEY);
    return this.getAll();
  },

  _getFromSheetCache: function () {
    var ss = SheetsService.getSpreadsheet();
    var sh = ss.getSheetByName(SheetsService.SHEETS.USERS_CACHE);
    if (!sh || sh.getLastRow() < 2) return [];

    var data = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
    return data
      .filter(function (r) { return r[0]; })
      .map(function (r) {
        return { email: r[0], name: r[1], photo: r[2] || null, department: r[3] || null };
      });
  },

  _saveToSheetCache: function (users) {
    try {
      var ss = SheetsService.getSpreadsheet();
      var sh = ss.getSheetByName(SheetsService.SHEETS.USERS_CACHE);
      if (!sh) {
        sh = ss.insertSheet(SheetsService.SHEETS.USERS_CACHE);
        sh.hideSheet();
      }
      sh.clearContents();
      sh.getRange(1, 1, 1, 4).setValues([['email', 'nombre', 'foto', 'departamento']]);
      if (users.length > 0) {
        sh.getRange(2, 1, users.length, 4).setValues(
          users.map(function (u) {
            return [u.email, u.name, u.photo || '', u.department || ''];
          })
        );
      }
    } catch (e) { /* fail silently */ }
  }
};
