// UI strings, written natively in each language (Arabic in a friendly Lebanese tone).
// Games add their own strings under "<gameId>.<key>" via registerStrings.
import type { Lang } from '../shared/protocol';

type Dict = Record<string, string>;

const en: Dict = {
  'app.name': 'Sahra',
  'app.tagline': 'Party games for your night in. Everyone plays from their phone.',
  'home.name': 'Your name',
  'home.namePh': 'Type your name',
  'home.create': 'Start a room',
  'home.or': 'Got a code? Join your friends',
  'home.codePh': 'CODE',
  'home.join': 'Join',
  'home.tv': 'Use this screen as the TV',
  'home.needName': 'Write your name first',
  'home.needCode': 'The room code is 4 letters',
  'join.title': 'Joining room {code}',
  'join.go': "Let's go",
  'room.notFound': "We couldn't find that room. Double check the code?",
  'room.home': 'Back to start',
  'room.code': 'Room code',
  'room.scan': 'Scan to join',
  'room.share': 'Share the link',
  'room.copied': 'Link copied',
  'room.players': 'Players {n}/12',
  'room.host': 'Host',
  'room.you': 'you',
  'room.away': 'away',
  'room.remove': 'Remove',
  'room.removeQ': 'Remove {name} from the room?',
  'room.pick': 'Pick a game',
  'room.mode': 'How are you playing?',
  'room.settings': 'Settings',
  'room.start': 'Start the game',
  'room.needMore': 'You need at least {n} players for this one',
  'room.waitHost': 'Waiting for {name} to start a game',
  'room.leave': 'Leave the room',
  'room.leaveQ': 'Leave this room?',
  'room.end': 'Back to the lobby',
  'room.endQ': 'End this game for everyone?',
  'room.again': 'Another round',
  'room.spectate': "A game is already on. You're in from the next round.",
  'room.points': 'pts',
  'room.kicked': 'The host removed you from this room.',
  'room.left': 'You left the room.',
  'room.gone': 'This room has closed.',
  'room.tvLink': 'TV screen link',
  'mode.phones': 'Phones only',
  'mode.phonesHint': 'Everyone sees everything on their own phone.',
  'mode.screen': 'TV + phones',
  'mode.screenHint': 'Open the TV link on a TV or laptop. Phones become controllers.',
  'mode.screens': 'TV screens connected: {n}',
  'tv.join': 'Join at',
  'tv.waiting': 'Waiting for the host to start',
  'tv.title': 'TV screen',
  'yes': 'Yes',
  'no': 'Cancel',
  'net.reconnecting': 'Reconnecting...',
  'err.full': 'This room is full (12 players).',
  'err.banned': 'You were removed from this room and cannot rejoin it.',
  'err.ip_limit': 'Too many players have joined from this connection.',
  'err.already_joined': 'You are already in this room.',
  'err.rate_limited': 'Too many tries. Wait a little and try again.',
  'err.name': 'Please write a name.',
  'err.not_host': 'Only the host can do that.',
  'err.too_few': 'You need at least {n} players online.',
  'err.too_many': 'Too many players for this game (max {n}).',
  'err.mode': "This game can't be played that way.",
  'err.in_game': 'Finish the current game first.',
  'err.game': "That move isn't allowed right now.",
  'err.game.no_content': "This game's cards aren't ready yet.",
  'err.generic': 'Something went wrong. Try again.',
};

const ar: Dict = {
  'app.name': 'سهرة',
  'app.tagline': 'ألعاب للسهرة مع الأهل والرفقات. كل واحد بيلعب من تلفونو.',
  'home.name': 'شو اسمك؟',
  'home.namePh': 'اكتب اسمك',
  'home.create': 'افتح غرفة',
  'home.or': 'معك كود؟ فوت عند رفقاتك',
  'home.codePh': 'الكود',
  'home.join': 'فوت',
  'home.tv': 'خلّي هالشاشة هي التلفزيون',
  'home.needName': 'اكتب اسمك أوّل',
  'home.needCode': 'كود الغرفة 4 أحرف',
  'join.title': 'عم تفوت عالغرفة {code}',
  'join.go': 'يلّا',
  'room.notFound': 'ما لقينا هالغرفة. تأكّد من الكود؟',
  'room.home': 'رجوع عالبداية',
  'room.code': 'كود الغرفة',
  'room.scan': 'صوّر الكود وفوت',
  'room.share': 'ابعت الرابط',
  'room.copied': 'نسخنا الرابط',
  'room.players': 'اللاعبين {n}/12',
  'room.host': 'صاحب السهرة',
  'room.you': 'إنت',
  'room.away': 'مش هون',
  'room.remove': 'طلّعو',
  'room.removeQ': 'أكيد بدك تطلّع {name} من الغرفة؟',
  'room.pick': 'نقّي لعبة',
  'room.mode': 'كيف بدكن تلعبو؟',
  'room.settings': 'الإعدادات',
  'room.start': 'يلّا نبلّش',
  'room.needMore': 'هاللعبة بدها {n} لاعبين عالأقل',
  'room.waitHost': 'ناطرين {name} يبلّش لعبة',
  'room.leave': 'اطلع من الغرفة',
  'room.leaveQ': 'أكيد بدك تطلع من الغرفة؟',
  'room.end': 'رجوع عالغرفة',
  'room.endQ': 'بدك توقّف اللعبة للكل؟',
  'room.again': 'جولة كمان',
  'room.spectate': 'في لعبة شغّالة. بتفوت معن من الجولة الجاية.',
  'room.points': 'نقطة',
  'room.kicked': 'صاحب السهرة طلّعك من الغرفة.',
  'room.left': 'طلعت من الغرفة.',
  'room.gone': 'هالغرفة تسكّرت.',
  'room.tvLink': 'رابط التلفزيون',
  'mode.phones': 'عالتلفونات بس',
  'mode.phonesHint': 'كل شي بيبيّن عتلفون كل واحد.',
  'mode.screen': 'تلفزيون وتلفونات',
  'mode.screenHint': 'افتح رابط التلفزيون عالتلفزيون أو اللابتوب، والتلفونات بيصيرو متل الريموت.',
  'mode.screens': 'شاشات موصولة: {n}',
  'tv.join': 'فوتو على',
  'tv.waiting': 'ناطرين صاحب السهرة يبلّش',
  'tv.title': 'شاشة التلفزيون',
  'yes': 'إيه',
  'no': 'لأ',
  'net.reconnecting': 'عم نرجع نوصل...',
  'err.full': 'الغرفة فوّلت (12 لاعب).',
  'err.banned': 'انطردت من هالغرفة وما فيك ترجع عليها.',
  'err.ip_limit': 'كتير لاعبين دخلو من هالاتصال.',
  'err.already_joined': 'إنت أصلاً بالغرفة.',
  'err.rate_limited': 'كتير محاولات. استنى شوي وجرّب كمان مرّة.',
  'err.name': 'اكتب اسم لو سمحت.',
  'err.not_host': 'بس صاحب السهرة فيه يعمل هيك.',
  'err.too_few': 'لازم يكون في {n} لاعبين موصولين عالأقل.',
  'err.too_many': 'كتير لاعبين لهاللعبة (الحد {n}).',
  'err.mode': 'هاللعبة ما بتنلعب هيك.',
  'err.in_game': 'خلّصو اللعبة يلّي شغّالة أوّل.',
  'err.game': 'هالحركة مش مسموحة هلّق.',
  'err.game.no_content': 'كروت هاللعبة مش جاهزة بعد.',
  'err.generic': 'صار في غلط. جرّب كمان مرّة.',
};

const dicts: Record<Lang, Dict> = { en, ar };
let current: Lang = 'en';

export function registerStrings(prefix: string, strings: Record<Lang, Dict>): void {
  for (const lang of ['en', 'ar'] as Lang[]) {
    for (const [k, v] of Object.entries(strings[lang] ?? {})) dicts[lang][`${prefix}.${k}`] = v;
  }
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = dicts[current][key] ?? dicts.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function getLang(): Lang {
  return current;
}

/** Switch UI language and flip the whole page direction. */
export function setLang(lang: Lang): void {
  current = lang;
  const root = document.documentElement;
  root.lang = lang;
  root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = lang === 'ar' ? 'سهرة' : 'Sahra';
}

export function preferredLang(): Lang {
  try {
    const saved = localStorage.getItem('sahra.lang');
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    // storage blocked
  }
  return (navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}
