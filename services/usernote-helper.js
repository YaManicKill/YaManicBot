'use strict';
const _ = require('lodash');
const moment = require('moment');
const r = require('./reddit');
const cache = new (require('node-cache'))({stdTTL: 900});

module.exports = {
  getNotes (subreddit, {refresh = false} = {}) {
    const cached_notes = cache.get(subreddit);
    if (cached_notes && !refresh) {
      return Promise.resolve(cached_notes);
    }
    return r.get_subreddit(subreddit).get_wiki_page('usernotes').content_md.then(JSON.parse).then(pageObject => {
      const parsed = _.assign(_.omit(pageObject, 'blob'), {notes: decompressBlob(pageObject.blob)});
      cache.set(subreddit, parsed);
      return parsed;
    });
  },
  getNotesSync(subreddit) {
    return cache.get(subreddit);
  },
  addNote ({mod, user, subreddit, note, warning = 'abusewarn', link, index, timestamp = moment().unix()}) {
    return module.exports.getNotes(subreddit, {refresh: true}).then(parsed => {
      _.merge(parsed.notes, {[user]: {ns: []}});
      index = index === undefined ? parsed.notes[user].ns.length : index;
      const newNote = {
        n: note,
        t: timestamp,
        m: (parsed.constants.users.indexOf(mod) + 1 || parsed.constants.users.push(mod)) - 1,
        w: (parsed.constants.warnings.indexOf(warning) + 1 || parsed.constants.warnings.push(warning)) - 1,
        l: link
      };
      parsed.notes[user].ns.splice(index, 0, newNote);
      return r.get_subreddit(subreddit).get_wiki_page('usernotes').edit({
        text: JSON.stringify(_(parsed).assign({blob: compressBlob(parsed.notes)}).omit('notes').value()),
        reason: `Added a note on /u/${user} (on behalf of ${mod})`
      }).then(() => {
        cache.set(subreddit, parsed);
        return newNote;
      });
    });
  },

  removeNote ({user, subreddit, index, requester}) {
    return module.exports.getNotes(subreddit, {refresh: true}).then(parsed => {
      const name = _.findKey(parsed.notes, (obj, username) => username.toLowerCase() === user.toLowerCase());
      if (!name || !_.isInteger(index) || !_.inRange(index, parsed.notes[name].ns.length)) {
        throw {error_message: 'Error: That note was not found.'};
      }
      const removedNote = parsed.notes[name].ns.splice(index, 1)[0];
      if (!parsed.notes[name].ns.length) {
        delete parsed.notes[name];
      }
      return r.get_subreddit(subreddit).get_wiki_page('usernotes').edit({
        text: JSON.stringify(_(parsed).assign({blob: compressBlob(parsed.notes)}).omit('notes').value()),
        reason: `Removed a note on /u/${user}${requester ? `(on behalf of ${requester})` : ''}`
      }).then(() => {
        cache.set(subreddit, parsed);
        return {
          m: removedNote.m,
          mod: parsed.constants.users[removedNote.m],
          user,
          subreddit,
          n: removedNote.n,
          note: removedNote.n,
          w: removedNote.w,
          warning: parsed.constants.warnings[removedNote.w],
          l: removedNote.l,
          link: removedNote.l,
          index,
          t: removedNote.t,
          timestamp: removedNote.t
        };
      });
    });
  }
};

function decompressBlob (blob) {
  return JSON.parse(require('zlib').inflateSync(Buffer.from(blob, 'base64')));
}

function compressBlob (notesObject) {
  return require('zlib').deflateSync(Buffer.from(JSON.stringify(notesObject))).toString('base64');
}