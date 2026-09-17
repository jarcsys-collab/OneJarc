export function toolPayload(definition) {
  return {
    toolName: definition.name.trim(),
    category: definition.category,
    description: definition.description,
    link: definition.applicationUrl,
    owner: definition.owner,
    tab: definition.openBehavior
  };
}

export async function submitNewTool(definition, settings, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(settings.createToolWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(settings.timeoutMs || 60000),
      body: JSON.stringify(toolPayload(definition))
    });
  } catch (error) {
    throw new Error(error.name === 'TimeoutError' || error.name === 'AbortError'
      ? 'The save request timed out. Check the database before retrying; the tool may have been created.'
      : 'Could not confirm the save. Check your connection and webhook CORS settings, and check the database before retrying.');
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error('The webhook returned an invalid response. Expected JSON with success: true. Check the database before retrying.'); }
  if (!response.ok || result?.success !== true) {
    throw new Error(typeof result?.error === 'string' ? result.error : `The webhook did not confirm the save (HTTP ${response.status}).`);
  }
  return result;
}
