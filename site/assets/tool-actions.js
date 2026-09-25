import { submit as editTool } from './edit-tool.js';
import { submit as duplicateTool } from './duplicate-tool.js';
import { submit as publishTool } from './publish-tool.js';
import { submit as unpublishTool } from './unpublish-tool.js';
import { submit as enableTool } from './enable-tool.js';
import { submit as disableTool } from './disable-tool.js';
import { submit as archiveTool } from './archive-tool.js';
import { submit as restoreTool } from './restore-tool.js';
const handlers = { edit: editTool, duplicate: duplicateTool, publish: publishTool, unpublish: unpublishTool, enable: enableTool, disable: disableTool, archive: archiveTool, restore: restoreTool };
export function actionName(command, entry) {
 if(command.type === 'save' && command.id) return 'edit';
 if(command.type === 'toggle-enabled') return entry.enabled ? 'enable' : 'disable';
 return command.type;
}
export async function submitToolAction(command, before, after, requestId) {
 const entry = command.type === 'duplicate' ? after.entries.find(item=>!before.entries.some(old=>old.id===item.id)) : after.entries.find(item=>item.id===command.id);
 const action = actionName(command, entry);
 if(!handlers[action]) throw new Error('No webhook adapter for '+action);
 return handlers[action]({action,id:command.id,requestId,publish:command.publish === true,entry});
}
