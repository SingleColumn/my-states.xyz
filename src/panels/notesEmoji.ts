/**
 * The emoji a note can reach for.
 *
 * Deliberately a short, hand-picked list rather than the whole Unicode set.
 * A full picker is a grid of two thousand pictures to hunt through; what a
 * writer actually wants is the dozen or so that mean something in a note --
 * a tick, a warning, a face -- found by typing the word for it. Anything
 * beyond this list can still be pasted, or taken from the operating
 * system's own picker (Windows key and full stop), and both round-trip
 * through Markdown unchanged, because an emoji is simply a character.
 *
 * Each entry carries the words people reach for as well as its name, so
 * `:tick` finds the check mark and `:warn` finds the warning sign.
 */
export interface EmojiEntry {
  char: string
  name: string
  keywords: string
}

export const noteEmoji: EmojiEntry[] = [
  // Marking things up: the reason most notes want emoji at all.
  { char: '✅', name: 'Done', keywords: 'check tick yes complete ok' },
  { char: '☑️', name: 'Ticked box', keywords: 'check tick todo done' },
  { char: '❌', name: 'No', keywords: 'cross x wrong fail no' },
  { char: '⚠️', name: 'Warning', keywords: 'caution careful warn risk' },
  { char: '❗', name: 'Important', keywords: 'exclamation urgent attention' },
  { char: '❓', name: 'Question', keywords: 'ask unsure unknown query' },
  { char: '💡', name: 'Idea', keywords: 'lightbulb suggestion think' },
  { char: '📌', name: 'Pinned', keywords: 'pin note remember keep' },
  { char: '📍', name: 'Place', keywords: 'pin location where map' },
  { char: '⭐', name: 'Star', keywords: 'favourite favorite best rating' },
  { char: '🔥', name: 'Fire', keywords: 'hot urgent popular' },
  { char: '🚀', name: 'Rocket', keywords: 'launch ship fast release' },
  { char: '🎯', name: 'Target', keywords: 'goal aim focus bullseye' },
  { char: '🧠', name: 'Brain', keywords: 'think idea mind clever' },
  { char: '🔑', name: 'Key', keywords: 'password access important' },
  { char: '🔒', name: 'Locked', keywords: 'lock private secure' },
  { char: '🔗', name: 'Link', keywords: 'chain url reference' },
  { char: '📎', name: 'Paperclip', keywords: 'attach file clip' },
  { char: '📝', name: 'Note', keywords: 'memo write writing pencil' },
  { char: '📄', name: 'Page', keywords: 'document file paper' },
  { char: '📁', name: 'Folder', keywords: 'directory files' },
  { char: '📊', name: 'Chart', keywords: 'graph data bar numbers' },
  { char: '📈', name: 'Going up', keywords: 'chart growth increase rising' },
  { char: '📉', name: 'Going down', keywords: 'chart decline decrease falling' },
  { char: '💰', name: 'Money', keywords: 'cash budget cost price' },
  { char: '🗓️', name: 'Calendar', keywords: 'date schedule day month' },
  { char: '⏰', name: 'Alarm', keywords: 'clock time deadline reminder' },
  { char: '⏳', name: 'Waiting', keywords: 'hourglass time pending later' },
  { char: '🔍', name: 'Search', keywords: 'find look magnifier research' },
  { char: '🛠️', name: 'Tools', keywords: 'fix build work repair' },
  { char: '🐛', name: 'Bug', keywords: 'error problem defect insect' },
  { char: '🧪', name: 'Experiment', keywords: 'test lab try prototype' },
  { char: '⚙️', name: 'Settings', keywords: 'gear config cog machine' },
  { char: '💻', name: 'Computer', keywords: 'laptop code work machine' },
  { char: '📱', name: 'Phone', keywords: 'mobile call device' },
  { char: '✉️', name: 'Email', keywords: 'mail message envelope letter' },
  { char: '📣', name: 'Announcement', keywords: 'megaphone shout news tell' },
  { char: '🏁', name: 'Finish', keywords: 'flag end goal race done' },

  // Faces: the tone of a line, which plain words often miss.
  { char: '🙂', name: 'Smiling face', keywords: 'happy smile glad pleased' },
  { char: '😀', name: 'Grinning face', keywords: 'happy grin smile joy' },
  { char: '😄', name: 'Laughing face', keywords: 'happy laugh grin joy' },
  { char: '😂', name: 'Crying with laughter', keywords: 'laugh funny lol tears' },
  { char: '😉', name: 'Winking face', keywords: 'wink joke playful' },
  { char: '😊', name: 'Blushing face', keywords: 'happy shy warm smile' },
  { char: '😍', name: 'Heart eyes', keywords: 'love adore like' },
  { char: '🤔', name: 'Thinking face', keywords: 'think hmm wonder unsure' },
  { char: '😐', name: 'Neutral face', keywords: 'meh flat blank' },
  { char: '😕', name: 'Confused face', keywords: 'unsure puzzled' },
  { char: '🙁', name: 'Frowning face', keywords: 'sad unhappy' },
  { char: '😢', name: 'Crying face', keywords: 'sad tear upset' },
  { char: '😴', name: 'Sleeping face', keywords: 'sleep tired bored zzz' },
  { char: '😅', name: 'Nervous smile', keywords: 'sweat awkward relief phew' },
  { char: '😎', name: 'Sunglasses', keywords: 'cool confident' },
  { char: '🤯', name: 'Mind blown', keywords: 'shock amazed wow' },
  { char: '😤', name: 'Frustrated face', keywords: 'annoyed angry steam' },
  { char: '🤞', name: 'Fingers crossed', keywords: 'hope luck wish' },
  { char: '🙏', name: 'Please or thanks', keywords: 'thanks pray hope grateful' },
  { char: '👍', name: 'Thumbs up', keywords: 'yes good agree approve like' },
  { char: '👎', name: 'Thumbs down', keywords: 'no bad disagree dislike' },
  { char: '👏', name: 'Applause', keywords: 'clap well done praise' },
  { char: '👋', name: 'Wave', keywords: 'hello hi bye greeting' },
  { char: '🤝', name: 'Handshake', keywords: 'deal agree partner meet' },
  { char: '💪', name: 'Strength', keywords: 'strong muscle effort' },
  { char: '🫶', name: 'Heart hands', keywords: 'love thanks care' },

  // Hearts and small warmth.
  { char: '❤️', name: 'Red heart', keywords: 'love like favourite favorite' },
  { char: '🧡', name: 'Orange heart', keywords: 'love heart' },
  { char: '💛', name: 'Yellow heart', keywords: 'love heart' },
  { char: '💚', name: 'Green heart', keywords: 'love heart' },
  { char: '💙', name: 'Blue heart', keywords: 'love heart' },
  { char: '💜', name: 'Purple heart', keywords: 'love heart' },
  { char: '🖤', name: 'Black heart', keywords: 'love heart dark' },
  { char: '✨', name: 'Sparkles', keywords: 'shine new magic nice' },
  { char: '🎉', name: 'Celebration', keywords: 'party congrats hooray launch' },
  { char: '🎈', name: 'Balloon', keywords: 'party birthday celebrate' },
  { char: '🎁', name: 'Gift', keywords: 'present birthday reward' },
  { char: '🏆', name: 'Trophy', keywords: 'win prize award best' },
  { char: '🥇', name: 'First place', keywords: 'gold medal win best' },

  // The ordinary furniture of a day.
  { char: '☕', name: 'Coffee', keywords: 'tea drink break morning' },
  { char: '🍵', name: 'Tea', keywords: 'drink break green' },
  { char: '🍺', name: 'Beer', keywords: 'drink pub celebrate' },
  { char: '🍕', name: 'Pizza', keywords: 'food lunch dinner' },
  { char: '🍰', name: 'Cake', keywords: 'birthday food sweet dessert' },
  { char: '🏠', name: 'Home', keywords: 'house building where' },
  { char: '🏢', name: 'Office', keywords: 'building work company' },
  { char: '✈️', name: 'Plane', keywords: 'travel flight trip holiday' },
  { char: '🚗', name: 'Car', keywords: 'drive travel journey' },
  { char: '🚆', name: 'Train', keywords: 'travel commute rail' },
  { char: '🌍', name: 'World', keywords: 'earth globe global planet' },
  { char: '🌱', name: 'Seedling', keywords: 'grow new start plant' },
  { char: '🌊', name: 'Wave', keywords: 'sea water ocean' },
  { char: '☀️', name: 'Sun', keywords: 'sunny weather bright day' },
  { char: '🌙', name: 'Moon', keywords: 'night late evening' },
  { char: '☁️', name: 'Cloud', keywords: 'weather grey overcast' },
  { char: '🌧️', name: 'Rain', keywords: 'weather wet shower' },
  { char: '❄️', name: 'Snow', keywords: 'weather cold winter freeze' },
  { char: '🎵', name: 'Music', keywords: 'note song sound audio' },
  { char: '🎧', name: 'Headphones', keywords: 'music listen audio' },
  { char: '🎨', name: 'Art', keywords: 'paint design creative picture' },
  { char: '📷', name: 'Camera', keywords: 'photo picture snap image' },
  { char: '🎬', name: 'Film', keywords: 'movie video clapper' },
  { char: '📺', name: 'Television', keywords: 'tv screen watch' },
  { char: '🐱', name: 'Cat', keywords: 'animal pet kitten' },
  { char: '🐶', name: 'Dog', keywords: 'animal pet puppy' },

  // Arrows and marks that stand in for punctuation.
  { char: '➡️', name: 'Arrow right', keywords: 'next then forward direction' },
  { char: '⬅️', name: 'Arrow left', keywords: 'back previous direction' },
  { char: '⬆️', name: 'Arrow up', keywords: 'above up direction' },
  { char: '⬇️', name: 'Arrow down', keywords: 'below down direction' },
  { char: '🔄', name: 'Repeat', keywords: 'refresh again cycle loop' },
  { char: '▶️', name: 'Play', keywords: 'start go run' },
  { char: '⏸️', name: 'Pause', keywords: 'hold stop wait' },
  { char: '•', name: 'Bullet', keywords: 'dot point list' },
  { char: '–', name: 'En dash', keywords: 'dash range hyphen' },
  { char: '—', name: 'Em dash', keywords: 'dash long punctuation' },
  { char: '…', name: 'Ellipsis', keywords: 'dots more unfinished' },
  { char: '°', name: 'Degree', keywords: 'temperature angle degrees' },
  { char: '×', name: 'Times', keywords: 'multiply by dimensions cross' },
  { char: '→', name: 'Thin arrow', keywords: 'arrow right to becomes' },
  { char: '£', name: 'Pound', keywords: 'money currency sterling gbp' },
  { char: '€', name: 'Euro', keywords: 'money currency eur' },
]
