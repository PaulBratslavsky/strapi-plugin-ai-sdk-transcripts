import type { Core } from '@strapi/strapi';

/**
 * Carry an install forward from the `ai-sdk-yt-transcripts` plugin id to
 * `youtube-transcripts`, and off the unprefixed `transcript` table.
 *
 * 2.0.0 changed both. The id prefixed every permission action and every tool
 * name; the table was called plain `transcript`, a name any other plugin or
 * content type could have taken. Without this, an upgrade would come back with
 * an empty transcript list and every tool grant revoked, and Strapi would raise
 * no error, because it would simply create the new table and find nothing in it.
 *
 * Runs on every boot and is a no-op once applied. Each step checks for the old
 * name and the absence of the new one, so an interrupted boot is safe to repeat.
 */

const OLD_TABLE = 'transcript';
const NEW_TABLE = 'youtube_transcripts';
const OLD_ACTION_PREFIX = 'plugin::ai-sdk-yt-transcripts.';
const NEW_ACTION_PREFIX = 'plugin::youtube-transcripts.';

async function tableExists(strapi: Core.Strapi, name: string): Promise<boolean> {
  try {
    return await strapi.db.connection.schema.hasTable(name);
  } catch {
    return false;
  }
}

export async function migrateFromAiSdkId(strapi: Core.Strapi): Promise<void> {
  const log = strapi.log;

  try {
    const hasOld = await tableExists(strapi, OLD_TABLE);
    const hasNew = await tableExists(strapi, NEW_TABLE);

    if (hasOld && !hasNew) {
      // Renaming preserves rows, ids and indexes, where a copy would renumber.
      await strapi.db.connection.schema.renameTable(OLD_TABLE, NEW_TABLE);
      log.info(`[youtube-transcripts] migrated table ${OLD_TABLE} -> ${NEW_TABLE}`);
    } else if (hasOld && hasNew) {
      // Strapi created the new table before this ran. Moving rows across is
      // still correct but not safe to guess at, so report it rather than
      // silently leaving data behind.
      const [{ count }] = await strapi.db.connection(OLD_TABLE).count({ count: '*' });
      if (Number(count) > 0) {
        log.warn(
          `[youtube-transcripts] ${OLD_TABLE} still holds ${count} row(s) and ${NEW_TABLE} exists. ` +
            `Move them manually: INSERT INTO ${NEW_TABLE} SELECT * FROM ${OLD_TABLE};`,
        );
      }
    }

    // Permission grants are rows keyed by an action string, so a renamed id
    // leaves every tick box in Settings > Roles pointing at nothing.
    // On a fresh database the table does not exist yet (register runs before
    // Strapi creates it), and then there are no grants to carry forward.
    if (!(await tableExists(strapi, 'admin_permissions'))) {
      return;
    }

    const renamed = await strapi.db
      .connection('admin_permissions')
      .where('action', 'like', `${OLD_ACTION_PREFIX}%`)
      .update({
        action: strapi.db.connection.raw(
          `replace(action, '${OLD_ACTION_PREFIX}', '${NEW_ACTION_PREFIX}')`,
        ),
      });

    if (renamed > 0) {
      log.info(`[youtube-transcripts] migrated ${renamed} permission grant(s)`);
    }
  } catch (error) {
    // Never take the host down over a migration. The site boots with the old
    // data intact and the operator gets something they can act on.
    log.error(
      `[youtube-transcripts] migration from the ai-sdk-yt-transcripts id failed: ` +
        `${(error as Error).message}. Existing data has not been modified.`,
    );
  }
}
