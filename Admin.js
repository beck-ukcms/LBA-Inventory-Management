/** Admin authentication and protected admin endpoints. */
const ADMIN_TOKEN_TTL_SECONDS = 1800;

function authenticateAdmin(code) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_CODE');
  if (!expected) throw new Error('ADMIN_CODE has not been configured in Script Properties.');
  if (String(code || '') !== String(expected)) return {ok: false, message: 'Incorrect administrative code.'};
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(`ADMIN_TOKEN_${token}`, '1', ADMIN_TOKEN_TTL_SECONDS);
  return {ok: true, token, expiresInMinutes: ADMIN_TOKEN_TTL_SECONDS / 60};
}

function requireAdmin_(token) {
  if (!token || CacheService.getScriptCache().get(`ADMIN_TOKEN_${token}`) !== '1') {
    throw new Error('Administrative session expired. Return to the main page and sign in again.');
  }
  CacheService.getScriptCache().put(`ADMIN_TOKEN_${token}`, '1', ADMIN_TOKEN_TTL_SECONDS);
}

function endAdminSession(token) {
  if (token) CacheService.getScriptCache().remove(`ADMIN_TOKEN_${token}`);
  return true;
}

function runSchemaValidationFromAdmin(token) {
  requireAdmin_(token);
  return validateInventorySchemaV1(false);
}
