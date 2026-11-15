// First time, in the language picked first (English or Suomi): what you want from Koti, your pay, your bills and how
// Koti should remind you, then your name (making friends: a handshake, and from there it calls you by it), your
// balance, how the month usually ends, who shares your money, what you're saving for, a summary of it all to check,
// what Koti will do for you, your data and Koti's AI, and last, creating the account.
// (15 November 2026: the questions come before signing up, signing up is last; then, from comments on the preview:
// the language first so everything after follows it, reminders next to the bills, a summary, privacy before email.)
// Each answer is saved as you go, so "Later" keeps what was already answered. What isn't a record (what you want, how
// the month feels, who shares it) goes into what Koti remembers, and all of it into a profile Koti works from
// (settings.profile). Signed in already, or no server: no account step. The bar is Koti's blue with how far along in
// percent; each step slides in (none with Reduce motion).
import { store } from "./data.js";
import { $, $$, esc, parseMoney, toast } from "./ui.js";
import { sync, signUp, signIn } from "./sync.js";
import { setBalanceNow } from "./money.js";
import { payDateFor, LAST_WORKING_DAY, LAST_DAY } from "./paydays.js";
import { remember } from "./brain.js";
import { consent, setConsent, showConsentBanner } from "./privacy.js";

/* Everything said, in both languages. A function where the words depend on an answer. */
export const TX = {
  en: {
    later: "Later", next: "Next", back: "Back", signin: "Sign in", step: (n, all, p) => `Step ${n} of ${all}, ${p}% done`,
    langT: "Which language shall we use?", langP: "Valitaan kieli. You can change it any time in You.", langEn: "Let's talk in English", langFi: "Puhutaan suomea",
    whyT: "What should we focus on?", whyP: "Hi, I'm Koti. Pick as many as you like: I'll keep them in mind and show you what matters to you first.", whyGo: "Next: your pay",
    WHY: [["spend", "Know what I can spend each day", "knowing what they can spend each day"], ["bills", "Stop bills catching me out", "not being caught out by bills"], ["save", "Save for something", "saving for something"],
      ["home", "Set up a new home", "setting up a new home"], ["shared", "Keep track of shared costs", "keeping track of shared costs"], ["where", "See where my money goes", "seeing where their money goes"]],
    whyMem: list => `Wants Koti's help with ${list}.`,
    payT: "Let's start with your pay", payP: "",
    payL: "What lands in your account each month, after tax", whenL: "And when does it land?", payDay: "On day", payGo: "Next: your bills",
    whenOpts: d => [[LAST_WORKING_DAY, "Last working day of the month", `This month that's ${d}`], [LAST_DAY, "Last day of the month", ""], ["date", "The same date every month", ""], ["varies", "It changes", "I'll ask when it lands"]],
    payErr: "Type what lands, like 2400. Or tap Later.", salary: "Salary",
    billsT: "What do you spend money on?", billsP: "Tap the bills you pay, or add your own, then the amount and the day each one is due. I'll set that money aside before telling you what's yours to spend. Anything due before today starts next month.",
    BILLS: ["Rent", "Electricity", "Water", "Phone", "Internet", "Home insurance", "Netflix", "Spotify", "Gym", "Travel card", "Loan"],
    addOwn: "+ Add your own", ownPh: "e.g. Daycare, Car loan, Union fee", ownL: "Your own bill", add: "Add", dayN: n => `Day ${n}`, amtOf: n => `${n} amount`, dueOf: n => `${n} is due on day`,
    billsErr: list => `Add an amount for ${list}, or tap it again to take it off.`, billsGo: "Next: reminders",
    nudgeT: "How shall we stay on track?", nudgeP: "I'll only nudge you for what you switch on here, and you can change it any time in You.",
    nBills: ["Before a bill is due", "A reminder the morning before, so nothing catches you out"], nPay: ["On payday", "What's yours to spend for the month ahead"], nWeek: ["A Sunday summary", "How the week went, in one short note"],
    nameT: "Before we go on, what should I call you?", nameP: "So we can be on first-name terms. I'll use it from here on, and whenever we talk about your money.",
    namePh: "Your name", nameL: "Your first name", handL: "And your hand", TONES: ["Default", "Light", "Medium-light", "Medium", "Medium-dark", "Dark"], nameGo: "Nice to meet you", nameErr: "Type your name, or tap Later.",
    meet: f => `Nice to meet you${f ? `, ${f}` : ""}`,
    // no "Thanks, Antti" on the balance: the handshake just said nice to meet you
    balT: () => "What does your bank say right now?", balP: "Open your bank app and copy the number over. You only do this once: from here I keep count with you.",
    balL: "Money in your account today", balP2: "With your pay, your bills and this, I work out how much is yours to spend every day.", balErr: "Type the number from your bank, like 1120.",
    feelT: f => `How does the end of the month usually feel${f ? `, ${f}` : ""}?`, feelP: "Pick all that are true: some months are different. It helps me know when to cheer you on and when to give you a gentle heads-up.",
    FEEL: [["left", "There's usually some left", "Usually has some money left at the end of the month."], ["just", "It just about makes it", "Money usually just about lasts to the end of the month."],
      ["short", "It often runs short", "Money often runs short before payday: be careful with it."], ["varies", "It changes a lot", "How the month ends changes a lot from month to month."]],
    pplT: "Who shares your money life?", pplP: "So I can talk about shared bills and costs the way they really work in your home.",
    PEOPLE: [["me", "Just me", "Manages money on their own."], ["partner", "Me and a partner", "Shares money with a partner."], ["family", "A family with children", "Has a family with children."], ["flat", "Flatmates", "Lives with flatmates and shares some costs."]],
    goalT: "Saving for something?", goalP: "Pick one and, if you know it, how much you'd like to have. I'll show how close you are and what to put aside each month.",
    whenGoalT: "When would you like to reach it?", whenGoalP: "I'll work out what to put aside each month to get there, and tell you if we're falling behind.",
    BY: [["3", "In 3 months"], ["6", "In 6 months"], ["12", "In a year"], ["24", "In 2 years"], ["date", "By a month I choose"], ["none", "No set date"]], byMonth: "Which month?", byErr: "Pick a month after this one, or another answer.",
    monthly: (m, by) => `${m} a month, ready by ${by}`, byWord: by => `by ${by}`,
    GOALS: ["Holiday", "Emergency fund", "New home", "Car", "Something else"], goalAmt: g => `How much for ${g === "Something else" ? "it" : g.toLowerCase()}?`, goalNone: "Not right now", goalErr: "Type an amount like 1500, or leave it empty.",
    sumT: f => `Here's what you told me${f ? `, ${f}` : ""}`, sumP: "Check it's all right. Tap Edit to change anything.", edit: "Edit", sumGo: "Looks good",
    rows: { lang: "Language", why: "What matters to you", pay: "Pay", bills: "Bills", nudges: "Reminders", name: "Name", balance: "Balance", feel: "End of the month", people: "Money at home", goal: "Saving for" },
    whenWord: { [LAST_WORKING_DAY]: "last working day", [LAST_DAY]: "last day of the month", varies: "it changes", date: d => `on day ${d}` }, perMonth: "a month",
    rBills: "bills", rPay: "payday", rWeek: "Sunday summary", off: "None", notSaid: "Not answered",
    learnT: f => `Here's how we'll work together${f ? `, ${f}` : ""}`, learnP: "From what you've told me. I'll keep learning as we go, and you can change any of it in You.", learnGo: "Sounds good", done: "Show me my month",
    privT: "Your data, your choice", privP: "I keep your records to work out your money: on this phone, and in your account if you create one. No ads, no tracking, and your data is never sold.",
    privAiT: "My AI", privAi: "Reading receipts, talking with me and today's note send what you scan, say or ask, with the records needed to answer, to OpenAI. Nothing is sent unless you allow it, and you can change your mind any time in You → Privacy.",
    privLink: "Read the privacy policy", privNo: "Only necessary", privYes: "Allow AI",
    accUpT: f => `Let's keep it safe${f ? `, ${f}` : ""}`, accInT: f => `Welcome back${f ? `, ${f}` : ""}`,
    accUpP: "Create your account and everything you've told me is saved, on every device you sign in on.", accInP: "Sign in, and what's in your account comes to this phone.",
    email: "Email", password: "Password", pwHint: "At least 8 characters. We'll email you to confirm the address.", haveAcc: "I already have an account", newAcc: "Create a new account instead",
    notNow: "Not now", create: "Create account", creating: "Creating your account…", signingIn: "Signing in…",
    sentT: f => `Check your email${f ? `, ${f}` : ""}`, sentP: e => `Open the link we sent to <b>${e}</b> to confirm it. Then sign in on any device and everything you've set up comes with you.`, sentP2: "Until then, I keep it all on this phone.",
    eMail: "Type your email address.", ePw: "The password needs at least 8 characters.", eLogin: "Email or password doesn't match. Try again.", eConfirm: "Confirm your email first: open the link we sent you.",
    eTaken: "That email already has an account. Tap “I already have an account” to sign in.", eNet: "Can't reach the server. Check your connection, or tap Not now.", madeT: "Account created. Syncing…", inT: "Signed in. Syncing…",
    plan: {
      spendTop: "Keep your daily number up top: what's yours to spend each day until payday.", spend: "Work out what's yours to spend each day until payday.",
      bills: (n, r) => `Set ${n ? `your ${n} ${n === 1 ? "bill" : "bills"}` : "your bills"} aside before anything else${r ? ", and remind you the morning before each one" : ""}.`,
      short: "Give you an early heads-up when money's getting tight, and help you find where to slow down.", varies: "Watch for the months that run short, and warn you before they do.",
      just: "Tell you when payday is close and what's left until then.", left: g => `Point out spare money${g ? ` that could go to your ${g.toLowerCase()} fund` : " you could put aside"}.`,
      goal: (g, t, by, m) => `Track your ${g === "Something else" ? "savings goal" : `${g.toLowerCase()} fund`}${t ? ` to ${t}` : ""}${by ? ` by ${by}` : ""}${m ? `: about ${m} a month` : ", and show what to put aside each month"}.`,
      partner: "Keep shared costs with your partner in mind when we talk.", family: "Keep the whole family's costs in mind when we talk.", flat: "Keep costs you share with flatmates in mind when we talk.",
      home: "Keep your Home setup close: rooms, what's bought and what's left.", where: "Show you where your money goes, by category, every week.", weekly: "Send you a short summary on Sunday evenings.",
    },
  },
  fi: {
    later: "Myöhemmin", next: "Seuraava", back: "Takaisin", signin: "Kirjaudu", step: (n, all, p) => `Vaihe ${n}/${all}, ${p} % valmiina`,
    langT: "Millä kielellä puhutaan?", langP: "Let's pick a language. Voit vaihtaa sen milloin vain kohdasta You.", langEn: "Let's talk in English", langFi: "Puhutaan suomea",
    whyT: "Mihin keskitytään?", whyP: "Hei, olen Koti. Valitse niin monta kuin haluat: pidän ne mielessä ja näytän sinulle tärkeimmät ensin.", whyGo: "Seuraavaksi: palkkasi",
    WHY: [["spend", "Tietää, paljonko voin käyttää päivässä", "tietää, paljonko voi käyttää päivässä"], ["bills", "Ettei laskut yllätä", "ettei laskut yllätä"], ["save", "Säästää johonkin", "säästää johonkin"],
      ["home", "Sisustaa uutta kotia", "sisustaa uutta kotia"], ["shared", "Pysyä kärryillä yhteisistä kuluista", "pysyä kärryillä yhteisistä kuluista"], ["where", "Nähdä, mihin rahat menevät", "nähdä, mihin rahat menevät"]],
    whyMem: list => `Haluaa Kotin apua: ${list}.`,
    payT: "Aloitetaan palkastasi", payP: "",
    payL: "Paljonko tilillesi tulee kuukaudessa verojen jälkeen", whenL: "Ja milloin se tulee?", payDay: "Päivänä", payGo: "Seuraavaksi: laskut",
    whenOpts: d => [[LAST_WORKING_DAY, "Kuun viimeisenä arkipäivänä", `Tässä kuussa se on ${d}`], [LAST_DAY, "Kuun viimeisenä päivänä", ""], ["date", "Samana päivänä joka kuukausi", ""], ["varies", "Se vaihtelee", "Kysyn, kun se tulee"]],
    payErr: "Kirjoita summa, esim. 2400. Tai napauta Myöhemmin.", salary: "Palkka",
    billsT: "Mihin käytät rahaa?", billsP: "Napauta laskut, jotka maksat, tai lisää omasi, ja sitten summa ja eräpäivä. Varaan sen rahan ennen kuin kerron, paljonko on sinun käytettävissäsi. Jos eräpäivä on jo mennyt, lasku alkaa ensi kuussa.",
    BILLS: ["Vuokra", "Sähkö", "Vesi", "Puhelin", "Internet", "Kotivakuutus", "Netflix", "Spotify", "Kuntosali", "Matkakortti", "Laina"],
    addOwn: "+ Lisää oma", ownPh: "esim. Päiväkoti, Autolaina, Liiton jäsenmaksu", ownL: "Oma lasku", add: "Lisää", dayN: n => `${n}. pv`, amtOf: n => `${n}, summa`, dueOf: n => `${n}, eräpäivä`,
    billsErr: list => `Lisää summa: ${list}, tai poista se napauttamalla uudelleen.`, billsGo: "Seuraavaksi: muistutukset",
    nudgeT: "Miten pysytään kärryillä?", nudgeP: "Muistutan vain siitä, minkä kytket päälle, ja voit muuttaa sitä milloin vain kohdasta You.",
    nBills: ["Ennen laskun eräpäivää", "Muistutus edellisenä aamuna, ettei mikään yllätä"], nPay: ["Palkkapäivänä", "Paljonko on käytettävissäsi seuraavaksi kuukaudeksi"], nWeek: ["Sunnuntain yhteenveto", "Miten viikko meni, yhdessä lyhyessä viestissä"],
    nameT: "Ennen kuin jatketaan: miten sinua kutsun?", nameP: "Ollaan sinut. Käytän nimeäsi tästä eteenpäin, aina kun puhumme raha-asioistasi.",
    namePh: "Nimesi", nameL: "Etunimesi", handL: "Ja kätesi", TONES: ["Oletus", "Vaalea", "Keskivaalea", "Keskisävy", "Keskitumma", "Tumma"], nameGo: "Hauska tutustua", nameErr: "Kirjoita nimesi tai napauta Myöhemmin.",
    meet: f => `Hauska tutustua${f ? `, ${f}` : ""}`,
    balT: () => "Paljonko tililläsi on juuri nyt?", balP: "Avaa pankkisovellus ja kopioi luku tähän. Teet tämän vain kerran: tästä eteenpäin pidän kirjaa kanssasi.",
    balL: "Rahaa tililläsi tänään", balP2: "Palkastasi, laskuistasi ja tästä lasken, paljonko on sinun käytettävissäsi joka päivä.", balErr: "Kirjoita luku pankistasi, esim. 1120.",
    feelT: f => `Miltä kuun loppu yleensä tuntuu${f ? `, ${f}` : ""}?`, feelP: "Valitse kaikki, jotka pitävät paikkansa: kuukaudet ovat erilaisia. Näin tiedän, milloin kannustaa ja milloin varoittaa ajoissa.",
    FEEL: [["left", "Yleensä jää jotain yli", "Rahaa jää yleensä yli kuun lopussa."], ["just", "Juuri ja juuri riittää", "Rahat riittävät yleensä juuri ja juuri kuun loppuun."],
      ["short", "Usein loppuu kesken", "Rahat loppuvat usein ennen palkkapäivää: ole niiden kanssa tarkka."], ["varies", "Vaihtelee paljon", "Kuun loppu vaihtelee paljon kuukaudesta toiseen."]],
    pplT: "Kenen kanssa jaat raha-asiat?", pplP: "Jotta puhun yhteisistä laskuista ja kuluista niin kuin ne kotonasi oikeasti menevät.",
    PEOPLE: [["me", "Vain minä", "Hoitaa raha-asiansa yksin."], ["partner", "Minä ja kumppani", "Jakaa raha-asiat kumppanin kanssa."], ["family", "Lapsiperhe", "Lapsiperhe."], ["flat", "Kämppikset", "Asuu kämppisten kanssa ja jakaa osan kuluista."]],
    goalT: "Säästätkö johonkin?", goalP: "Valitse yksi ja, jos tiedät, paljonko haluaisit säästää. Näytän, kuinka lähellä olet ja paljonko kannattaa laittaa sivuun joka kuukausi.",
    whenGoalT: "Milloin haluaisit olla perillä?", whenGoalP: "Lasken, paljonko laittaa sivuun joka kuukausi, ja kerron, jos jäämme jälkeen.",
    BY: [["3", "3 kuukaudessa"], ["6", "6 kuukaudessa"], ["12", "Vuodessa"], ["24", "Kahdessa vuodessa"], ["date", "Valitsemaani kuukauteen mennessä"], ["none", "Ei tiettyä aikaa"]], byMonth: "Mihin kuukauteen mennessä?", byErr: "Valitse tätä myöhempi kuukausi tai toinen vaihtoehto.",
    monthly: (m, by) => `${m} kuukaudessa, valmis ${by}`, byWord: by => `${by} mennessä`,
    GOALS: ["Loma", "Puskurirahasto", "Uusi koti", "Auto", "Jokin muu"], goalAmt: () => "Paljonko tavoittelet?", goalNone: "Ei nyt", goalErr: "Kirjoita summa, esim. 1500, tai jätä tyhjäksi.",
    sumT: f => `Tässä mitä kerroit${f ? `, ${f}` : ""}`, sumP: "Tarkista, että kaikki on oikein. Napauta Muuta, jos jotain pitää vaihtaa.", edit: "Muuta", sumGo: "Näyttää hyvältä",
    rows: { lang: "Kieli", why: "Mikä on sinulle tärkeää", pay: "Palkka", bills: "Laskut", nudges: "Muistutukset", name: "Nimi", balance: "Saldo", feel: "Kuun loppu", people: "Talous", goal: "Säästötavoite" },
    whenWord: { [LAST_WORKING_DAY]: "viimeisenä arkipäivänä", [LAST_DAY]: "kuun viimeisenä päivänä", varies: "vaihtelee", date: d => `${d}. päivänä` }, perMonth: "kuukaudessa",
    rBills: "laskut", rPay: "palkkapäivä", rWeek: "sunnuntain yhteenveto", off: "Ei mitään", notSaid: "Ei vastattu",
    learnT: f => `Näin teemme tätä yhdessä${f ? `, ${f}` : ""}`, learnP: "Sen perusteella, mitä kerroit. Opin lisää matkan varrella, ja voit muuttaa mitä tahansa kohdasta You.", learnGo: "Kuulostaa hyvältä", done: "Näytä kuukauteni",
    privT: "Tietosi, valintasi", privP: "Säilytän tietosi, jotta voin laskea raha-asiasi: tällä puhelimella ja tililläsi, jos luot sellaisen. Ei mainoksia, ei seurantaa, eikä tietojasi myydä koskaan.",
    privAiT: "Tekoälyni", privAi: "Kuittien lukeminen, keskustelu kanssani ja päivän muistiinpano lähettävät skannaamasi, sanomasi tai kysymäsi ja vastaamiseen tarvittavat tiedot OpenAI:lle. Mitään ei lähetetä ilman lupaasi, ja voit muuttaa mielesi milloin vain kohdasta You → Privacy.",
    privLink: "Lue tietosuojaseloste", privNo: "Vain välttämättömät", privYes: "Salli tekoäly",
    accUpT: f => `Pidetään ne tallessa${f ? `, ${f}` : ""}`, accInT: f => `Tervetuloa takaisin${f ? `, ${f}` : ""}`,
    accUpP: "Luo tili, niin kaikki kertomasi tallentuu jokaiselle laitteelle, jolla kirjaudut.", accInP: "Kirjaudu, niin tilisi tiedot tulevat tälle puhelimelle.",
    email: "Sähköposti", password: "Salasana", pwHint: "Vähintään 8 merkkiä. Lähetämme sähköpostin osoitteen vahvistamiseksi.", haveAcc: "Minulla on jo tili", newAcc: "Luo uusi tili",
    notNow: "Ei nyt", create: "Luo tili", creating: "Luodaan tiliä…", signingIn: "Kirjaudutaan…",
    sentT: f => `Tarkista sähköpostisi${f ? `, ${f}` : ""}`, sentP: e => `Avaa linkki, jonka lähetimme osoitteeseen <b>${e}</b>, ja vahvista se. Sen jälkeen voit kirjautua millä tahansa laitteella, ja kaikki asettamasi tulee mukana.`, sentP2: "Siihen asti pidän kaiken tällä puhelimella.",
    eMail: "Kirjoita sähköpostiosoitteesi.", ePw: "Salasanassa on oltava vähintään 8 merkkiä.", eLogin: "Sähköposti tai salasana ei täsmää. Yritä uudelleen.", eConfirm: "Vahvista ensin sähköpostisi: avaa lähettämämme linkki.",
    eTaken: "Tällä sähköpostilla on jo tili. Napauta ”Minulla on jo tili” ja kirjaudu.", eNet: "Palvelimeen ei saada yhteyttä. Tarkista yhteys tai napauta Ei nyt.", madeT: "Tili luotu. Synkronoidaan…", inT: "Kirjauduttu. Synkronoidaan…",
    plan: {
      spendTop: "Pidän päivän summasi ylimpänä: paljonko voit käyttää joka päivä palkkapäivään asti.", spend: "Lasken, paljonko voit käyttää joka päivä palkkapäivään asti.",
      bills: (n, r) => `Varaan ${n ? `${n} ${n === 1 ? "laskusi" : "laskuasi"}` : "laskusi"} ennen mitään muuta${r ? " ja muistutan edellisenä aamuna jokaisesta" : ""}.`,
      short: "Varoitan ajoissa, kun rahat alkavat käydä vähiin, ja autan löytämään, mistä hidastaa.", varies: "Seuraan kuukausia, jotka jäävät vajaiksi, ja varoitan ennen kuin niin käy.",
      just: "Kerron, kun palkkapäivä on lähellä ja paljonko on jäljellä siihen asti.", left: g => `Kerron, kun rahaa jää yli${g ? ` ja sen voisi laittaa tavoitteeseen ${g.toLowerCase()}` : " ja sen voisi laittaa sivuun"}.`,
      goal: (g, t, by, m) => `Seuraan säästötavoitettasi${g === "Jokin muu" ? "" : ` (${g.toLowerCase()})`}${t ? `, ${t}` : ""}${by ? `, ${by} mennessä` : ""}${m ? `: noin ${m} kuukaudessa` : ", ja näytän, paljonko laittaa sivuun joka kuukausi"}.`,
      partner: "Pidän yhteiset kulut kumppanisi kanssa mielessä, kun puhumme.", family: "Pidän koko perheen kulut mielessä, kun puhumme.", flat: "Pidän kämppisten kanssa jaetut kulut mielessä, kun puhumme.",
      home: "Pidän kotiprojektisi lähellä: huoneet, mitä on ostettu ja mitä puuttuu.", where: "Näytän joka viikko, mihin rahasi menevät, luokittain.", weekly: "Lähetän lyhyen yhteenvedon sunnuntai-iltaisin.",
    },
  },
};
/* Kept for the code that reads them by name (codes and English labels). */
export const WHY = TX.en.WHY, FEEL = TX.en.FEEL, PEOPLE = TX.en.PEOPLE, GOALS = TX.en.GOALS;
/* Skin tones for their hand (the wave, and the handshake after their name): the default yellow, then five tones. */
export const TONES = ["", "\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"].map((m, k) => [m, TX.en.TONES[k]]);
/* The steps, in order. */
export const STEPS = ["lang", "why", "pay", "bills", "nudges", "name", "balance", "feel", "people", "goal", "goalWhen", "summary", "learned", "privacy", "account"];

/* What Koti will do for them, from their answers: shown on "Here's how I'll work for you", at most five lines. The
   same answers (settings.profile) go to Koti with every question, so it really works this way. */
export function planFor(p = {}, lang = "en") {
  const T = TX[lang === "fi" ? "fi" : "en"], P = T.plan, out = [], why = new Set(p.why || []), money = moneyIn(lang);
  const goal = p.goal && p.goal.name ? T.GOALS[GOALS.indexOf(p.goal.name)] || p.goal.name : null;   // kept by its English name, said in theirs
  out.push(why.has("spend") || !why.size ? P.spendTop : P.spend);
  if (p.bills || why.has("bills")) out.push(P.bills(p.bills, p.nudges && p.nudges.bills));
  // how the month ends: several can be true; the most careful one first, and spare money too when there's some
  const feels = [].concat(p.feel || []), careful = ["short", "varies", "just"].find(f => feels.includes(f));
  if (careful) out.push(P[careful]);
  if (feels.includes("left")) out.push(P.left(goal));
  if (goal) out.push(P.goal(goal, p.goal.target ? money(p.goal.target) : null, p.goal.by ? monthName(p.goal.by, lang) : null, p.goal.monthly ? money(p.goal.monthly) : null));
  if (p.people && p.people !== "me" && P[p.people]) out.push(P[p.people]);
  if (why.has("home")) out.push(P.home);
  if (why.has("where")) out.push(P.where);
  if (p.nudges && p.nudges.weekly) out.push(P.weekly);
  return out.filter(Boolean).slice(0, 5);
}
/* "June 2027" / "kesäkuu 2027" for a goal's YYYY-MM-DD. */
export const monthName = (d, lang = "en") => new Date(d + "T12:00:00Z").toLocaleDateString(lang === "fi" ? "fi-FI" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
/* The day a goal is for, in this many months (the first of that month), and what to put aside each month for it. */
export function goalBy(months, target, today = new Date()) {
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth() + months, 1)), by = d.toISOString().slice(0, 10);
  return { by, monthly: target ? Math.ceil(target / months) : null };
}
const moneyIn = lang => v => new Intl.NumberFormat(lang === "fi" ? "fi-FI" : "en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

const nextMonthStart = () => { const d = new Date(); const n = new Date(d.getFullYear(), d.getMonth() + 1, 1); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`; };
let el = null, step = 0, st = null, dir = 1;
const L = () => TX[st && st.lang === "fi" ? "fi" : "en"];
/* The steps shown: the account is left out when signed in already, or with no server. */
const steps = () => STEPS.filter(s => !(s === "account" && (sync.user || !sync.configured)) && !(s === "goalWhen" && st && !st.goal));   // the date only with a goal
export const stepCount = () => steps().length;
const id = () => steps()[step];
const go = s => { step = steps().indexOf(s); };

export function shouldOnboard() {
  const S = store.model.settings, m = store.model;
  return !S.setupDone && !m.income.length && !m.bills.length && !(S.startDate && S.startBalance != null);
}
export function openOnboarding() {
  const S = store.model.settings, R = S.reminders || {};
  el = $("#onb"); step = 0; dir = 1;
  st = { lang: String(S.voiceLang || "en-GB").startsWith("fi") ? "fi" : "en", why: new Set(), amount: "", when: LAST_WORKING_DAY, day: 25, picked: new Set(), custom: [], adding: false, newBill: "", amounts: {}, days: {},
    balance: "", feel: new Set(), people: null, goal: null, goalAmt: "", by: null, byMonth: "", nudge: { bills: R.bills !== false, payday: R.payday !== false, weekly: !!R.weekly },
    name: S.name || "", tone: Math.max(0, Math.min(5, Number(S.skinTone) || 0)), email: "", mode: "up", sent: false, back: null, ids: {} };
  el.hidden = false; document.body.classList.add("onb-open"); paint();
}
/* Data arrived from another device while the questions were open: they're already answered there. */
export function dismissIfAnswered() {
  if (!el || el.hidden || shouldOnboard()) return;
  if (store.model.income.some(x => x.id !== (st && st.ids.income))) { el.hidden = true; el.innerHTML = ""; document.body.classList.remove("onb-open"); }
}
/* Finished (or the account left for later): the month, and the AI question if they never got to it. */
function close() {
  el.hidden = true; el.innerHTML = ""; document.body.classList.remove("onb-open"); store.updateSettings({ setupDone: true }); location.hash = "#now";
  if (!consent()) showConsentBanner();
}

/* The bar, and how far along as a percentage that counts up with it ("40%"). */
function progress() {
  const all = stepCount(), n = step, from = Math.max(0, Math.round(((n + 1 - dir) / all) * 100)), to = Math.round(((n + 1) / all) * 100);
  return `<div class="onb-progw"><div class="onb-prog" role="progressbar" aria-label="${esc(L().step(n + 1, all, to))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${to}"><i style="width:${from}%" data-to="${to}"></i></div><span class="onb-pct" aria-hidden="true" data-from="${from}">${from}%</span></div>`;
}
const hand = (base, t = st.tone) => base + TONES[t][0];
const back = () => (step > 0 ? `<button type="button" class="onb-back" data-back>${L().back}</button>` : sync.configured && !sync.user ? `<button type="button" class="onb-back" data-signin-first>${L().signin}</button>` : "");
const head = (title, sub) => `<div class="onb-in">${progress()}${back()}<h1>${title}</h1>${sub ? `<p class="onb-p">${sub}</p>` : ""}`;
const radios = (name, opts, cur) => `<div class="onb-opts" role="radiogroup" aria-label="${esc(name)}">${opts.map(([v, t, s]) => `<button type="button" role="radio" class="onb-opt" data-pick="${esc(String(v))}" aria-checked="${String(cur) === String(v)}"><i aria-hidden="true"></i><span><b>${esc(t)}</b>${s ? `<small>${esc(s)}</small>` : ""}</span></button>`).join("")}</div>`;
const chips = (opts, on, key, extra = "") => `<div class="onb-chips">${opts.map(([v, t]) => `<button type="button" class="onb-chip${v === st.just ? " just" : ""}" data-${key}="${esc(v)}" aria-pressed="${on(v)}">${esc(t)}</button>`).join("")}${extra}</div>`;
const toggle = (key, [t, s], on) => `<button type="button" role="switch" class="onb-tog" data-nudge="${key}" aria-checked="${on}"><span><b>${esc(t)}</b><small>${esc(s)}</small></span><i aria-hidden="true"></i></button>`;
const foot = label => `<div class="onb-foot"><button type="button" class="onb-later" data-later>${L().later}</button><button type="button" class="onb-go" data-next>${label}</button></div>`;
const tail = label => `<p class="onb-msg" id="obMsg" aria-live="polite"></p>${foot(label)}</div>`;
const first = () => esc(String(st.name || "").trim().split(/\s+/)[0]);
const focus = sel => setTimeout(() => { const f = el && $(sel, el); if (f) f.focus(); }, 60);
const allBills = () => [...L().BILLS, ...st.custom];

/* What they told Koti, as rows to check: each can be edited (back to that question, then back here). */
function summaryRows() {
  const T = L(), money = moneyIn(st.lang), rows = [], none = `<span class="onb-none">${T.notSaid}</span>`;
  const label = (list, v) => (list.find(x => x[0] === v) || [])[1];
  rows.push(["lang", st.lang === "fi" ? "Suomi" : "English"]);
  rows.push(["why", st.why.size ? T.WHY.filter(([v]) => st.why.has(v)).map(([, t]) => esc(t)).join(", ") : none]);
  const amount = parseMoney(st.amount), w = T.whenWord[st.when], when = typeof w === "function" ? w(st.day) : w;
  rows.push(["pay", amount ? `${money(amount)} · ${esc(when)}` : st.when === "varies" ? esc(when) : none]);
  const bills = [...st.picked].map(n => [n, parseMoney(st.amounts[n])]).filter(([, a]) => a), sum = bills.reduce((s, [, a]) => s + a, 0);
  rows.push(["bills", bills.length ? `${bills.map(([n, a]) => `${esc(n)} ${money(a)}`).join(", ")} · ${money(sum)} ${T.perMonth}` : none]);
  const on = [st.nudge.bills && T.rBills, st.nudge.payday && T.rPay, st.nudge.weekly && T.rWeek].filter(Boolean);
  rows.push(["nudges", on.length ? esc(on.join(", ").replace(/^./, c => c.toUpperCase())) : T.off]);
  rows.push(["name", st.name ? `${esc(st.name)} ${hand("\u{1F44B}")}` : none]);
  const bal = parseMoney(st.balance);
  rows.push(["balance", bal != null && !Number.isNaN(bal) ? money(/^\s*-/.test(st.balance) ? -bal : bal) : none]);
  rows.push(["feel", st.feel.size ? T.FEEL.filter(([v]) => st.feel.has(v)).map(([, t]) => esc(t)).join(", ") : none]);
  rows.push(["people", st.people ? esc(label(T.PEOPLE, st.people)) : none]);
  const gi = GOALS.indexOf(st.goal), gt = parseMoney(st.goalAmt);
  const pg = (store.model.settings.profile || {}).goal || {};
  rows.push(["goal", st.goal ? `${esc(T.GOALS[gi] || st.goal)}${gt ? ` · ${money(gt)}` : ""}${pg.by ? ` · ${esc(pg.monthly ? T.monthly(money(pg.monthly), monthName(pg.by, st.lang)) : T.byWord(monthName(pg.by, st.lang)))}` : ""}` : none]);
  return rows;
}

function paint() {
  const now = new Date(), s = id(), T = L(), f = first();
  el.classList.toggle("lake", s === "balance");
  el.dataset.dir = dir > 0 ? "fwd" : dir < 0 ? "back" : "stay";   // a redraw within a step doesn't slide
  document.documentElement.lang = st.lang;
  if (s === "lang") {
    el.innerHTML = head(T.langT, T.langP) + `<div class="onb-langs" role="radiogroup" aria-label="${esc(T.langT)}">${[["en", "English", T.langEn], ["fi", "Suomi", T.langFi]].map(([v, t, sub]) => `<button type="button" role="radio" class="onb-lang" data-lang="${v}" aria-checked="${st.lang === v}" lang="${v}"><b>${t}</b><small>${sub}</small></button>`).join("")}</div>`
      + `<div class="onb-foot"><button type="button" class="onb-go" data-next>${T.next}</button></div></div>`;   // no Later: there's always a language
  } else if (s === "why") {
    el.innerHTML = head(T.whyT, T.whyP) + chips(T.WHY.map(([v, t]) => [v, t]), v => st.why.has(v), "why") + tail(T.whyGo);
  } else if (s === "pay") {
    const d = payDateFor(LAST_WORKING_DAY, now.getFullYear(), now.getMonth()).toLocaleDateString(st.lang === "fi" ? "fi-FI" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
    el.innerHTML = head(T.payT, T.payP)
      + `<label class="onb-l onb-q" for="obAmt">${T.payL}</label>
      <input class="onb-amt num" id="obAmt" inputmode="decimal" placeholder="€0" value="${esc(st.amount)}" autocomplete="off">
      <p class="onb-l onb-q" id="obWhen">${T.whenL}</p>${radios(T.whenL, T.whenOpts(d), st.when)}
      <label class="onb-day" id="obDayRow" ${st.when === "date" ? "" : "hidden"}>${T.payDay} <select id="obDay">${Array.from({ length: 31 }, (_, k) => `<option value="${k + 1}"${k + 1 === st.day ? " selected" : ""}>${k + 1}</option>`).join("")}</select></label>`
      + tail(T.payGo);
    focus("#obAmt");
  } else if (s === "bills") {
    el.innerHTML = head(T.billsT, T.billsP)
      + chips(allBills().map(n => [n, n]), n => st.picked.has(n), "bill", st.adding ? "" : `<button type="button" class="onb-chip onb-add" data-addbill>${T.addOwn}</button>`)
      + (st.adding ? `<div class="onb-newbill"><label class="sr" for="obNewBill">${T.ownL}</label><input class="onb-field" id="obNewBill" placeholder="${esc(T.ownPh)}" maxlength="40" value="${esc(st.newBill)}" enterkeyhint="done" autocapitalize="sentences"><button type="button" class="onb-addgo" data-savebill>${T.add}</button></div>` : "")
      + `<div class="onb-rows">${[...st.picked].map(n => `<div class="onb-row"><span>${esc(n)}</span><input inputmode="decimal" placeholder="€0" aria-label="${esc(T.amtOf(n))}" data-amt="${esc(n)}" value="${esc(st.amounts[n] || "")}"><select aria-label="${esc(T.dueOf(n))}" data-dday="${esc(n)}">${Array.from({ length: 31 }, (_, k) => `<option value="${k + 1}"${k + 1 === (st.days[n] || 1) ? " selected" : ""}>${T.dayN(k + 1)}</option>`).join("")}</select></div>`).join("")}</div>`
      + tail(T.billsGo);
    if (st.adding) { focus("#obNewBill"); $("#obNewBill", el).addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addBill(); } }); }
  } else if (s === "nudges") {
    el.innerHTML = head(T.nudgeT, T.nudgeP) + `<div class="onb-togs">${toggle("bills", T.nBills, st.nudge.bills)}${toggle("payday", T.nPay, st.nudge.payday)}${toggle("weekly", T.nWeek, st.nudge.weekly)}</div>` + tail(T.next);
  } else if (s === "name") {
    el.innerHTML = `<div class="onb-in">${progress()}${back()}
      <div class="onb-hi" aria-hidden="true"><span class="onb-wave">${hand("\u{1F44B}")}</span></div>
      <h1>${T.nameT}</h1><p class="onb-p">${T.nameP}</p>
      <label class="sr" for="obName">${T.nameL}</label>
      <input class="onb-amt onb-name" id="obName" placeholder="${esc(T.namePh)}" value="${esc(st.name)}" maxlength="40" autocomplete="given-name" autocapitalize="words" enterkeyhint="next">
      <p class="onb-l" id="obToneL">${T.handL}</p>
      <div class="onb-tones" role="radiogroup" aria-labelledby="obToneL">${TONES.map((_, k) => `<button type="button" role="radio" class="onb-tone" data-tone="${k}" aria-checked="${k === st.tone}" aria-label="${esc(T.TONES[k])}"><span aria-hidden="true">${hand("\u{270B}", k)}</span></button>`).join("")}</div>`
      + tail(T.nameGo);
    focus("#obName");
    $("#obName", el).addEventListener("keydown", e => { if (e.key === "Enter") { keepRows(); next(false); } });
  } else if (s === "balance") {
    el.innerHTML = head(T.balT(f), T.balP)
      + `<label class="sr" for="obBal">${T.balL}</label><input class="onb-amt big num" id="obBal" inputmode="decimal" placeholder="€0" value="${esc(st.balance)}" autocomplete="off"><p class="onb-p">${T.balP2}</p>` + tail(T.next);
    focus("#obBal");
  } else if (s === "feel") {
    el.innerHTML = head(T.feelT(f), T.feelP) + chips(T.FEEL.map(([v, t]) => [v, t]), v => st.feel.has(v), "feel") + tail(T.next);
  } else if (s === "people") {
    el.innerHTML = head(T.pplT, T.pplP) + radios(T.pplT, T.PEOPLE.map(([v, t]) => [v, t]), st.people) + tail(T.next);
  } else if (s === "goal") {
    el.innerHTML = head(T.goalT, T.goalP)
      + chips(GOALS.map((g, k) => [g, T.GOALS[k]]), g => st.goal === g, "goal")
      + (st.goal ? `<label class="onb-l" for="obGoalAmt">${esc(T.goalAmt(st.goal))}</label><input class="onb-amt num" id="obGoalAmt" inputmode="decimal" placeholder="€0" value="${esc(st.goalAmt)}" autocomplete="off">` : "")
      + tail(st.goal ? T.next : T.goalNone);
    if (st.goal && dir === 0) focus("#obGoalAmt");
  } else if (s === "goalWhen") {
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1), min = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;
    el.innerHTML = head(T.whenGoalT, T.whenGoalP) + radios(T.whenGoalT, T.BY, st.by)
      + `<label class="onb-day" id="obByRow" ${st.by === "date" ? "" : "hidden"}>${T.byMonth} <input type="month" id="obByMonth" min="${min}" value="${esc(st.byMonth)}"></label>` + tail(T.next);
  } else if (s === "summary") {
    el.innerHTML = head(T.sumT(f), T.sumP)
      + `<dl class="onb-sum">${summaryRows().map(([k, v]) => `<div class="onb-sumrow"><dt>${T.rows[k]}</dt><dd>${v}</dd><button type="button" class="onb-edit" data-edit="${k}" aria-label="${esc(`${T.edit}: ${T.rows[k]}`)}">${T.edit}</button></div>`).join("")}</dl>`
      + `<div class="onb-foot"><button type="button" class="onb-go" data-next>${T.sumGo}</button></div></div>`;
  } else if (s === "learned") {
    const plan = planFor(store.model.settings.profile || {}, st.lang);
    el.innerHTML = head(T.learnT(f), T.learnP)
      + `<ul class="onb-plan">${plan.map((t, k) => `<li style="--k:${k}"><i aria-hidden="true"></i><span>${esc(t)}</span></li>`).join("")}</ul>`
      + `<div class="onb-foot"><button type="button" class="onb-go" data-next>${T.learnGo}</button></div></div>`;
  } else if (s === "privacy") {
    el.innerHTML = head(T.privT, T.privP)
      + `<div class="onb-priv"><h2>${T.privAiT}</h2><p>${T.privAi}</p><a href="privacy.html" target="_blank" rel="noopener">${T.privLink}</a></div>
      <div class="onb-foot onb-two"><button type="button" class="onb-go ghost" data-ai="no">${T.privNo}</button><button type="button" class="onb-go" data-ai="yes">${T.privYes}</button></div></div>`;
  } else {
    el.innerHTML = st.sent ? `<div class="onb-in">${progress()}
      <div class="onb-hi" aria-hidden="true"><span class="onb-pop">✉️</span></div>
      <h1>${T.sentT(f)}</h1><p class="onb-p">${T.sentP(esc(st.email))}</p><p class="onb-p">${T.sentP2}</p>
      <div class="onb-foot"><button type="button" class="onb-go" data-done>${T.done}</button></div></div>`
    : `<div class="onb-in">${progress()}${back()}
      <h1>${st.mode === "up" ? T.accUpT(f) : T.accInT(f)}</h1><p class="onb-p">${st.mode === "up" ? T.accUpP : T.accInP}</p>
      <div class="onb-form">
        <label class="onb-l" for="obEmail">${T.email}</label>
        <input class="onb-field" id="obEmail" type="email" inputmode="email" autocomplete="email" spellcheck="false" value="${esc(st.email)}" enterkeyhint="next">
        <label class="onb-l" for="obPass">${T.password}</label>
        <input class="onb-field" id="obPass" type="password" autocomplete="${st.mode === "up" ? "new-password" : "current-password"}" minlength="8" enterkeyhint="go">
        <p class="onb-hint">${st.mode === "up" ? T.pwHint : ""}</p>
        <button type="button" class="onb-switch" data-switch>${st.mode === "up" ? T.haveAcc : T.newAcc}</button>
      </div>
      <p class="onb-msg" id="obMsg" aria-live="polite"></p>
      <div class="onb-foot"><button type="button" class="onb-later" data-later>${T.notNow}</button><button type="button" class="onb-go" data-next>${st.mode === "up" ? T.create : T.signin}</button></div></div>`;
    if (!st.sent) { focus(st.email ? "#obPass" : "#obEmail"); $("#obPass", el).addEventListener("keydown", e => { if (e.key === "Enter") { keepRows(); next(false); } }); }
  }
  // the bar fills to this step with the percentage counting up, and the step slides in
  requestAnimationFrame(() => {
    const bar = el && $(".onb-prog i", el), pct = el && $(".onb-pct", el); if (!bar) return;
    bar.style.width = bar.dataset.to + "%";
    const a = Number(pct.dataset.from), b = Number(bar.dataset.to), t0 = performance.now();
    const tick = t => { const k = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - k, 3); pct.textContent = `${Math.round(a + (b - a) * e)}%`; if (k < 1) requestAnimationFrame(tick); };
    if (a !== b) requestAnimationFrame(tick); else pct.textContent = `${b}%`;
  });
  el.onclick = onClick;
  if (dir !== 0) el.scrollTop = 0;
}

/* A tap: choices redraw the step in place (no slide); Back, Later and Next move. */
function onClick(e) {
  const t = e.target, again = (just = null) => { keepRows(); st.just = just; dir = 0; paint(); st.just = null; };
  if (t.closest("[data-signin-first]")) { el.hidden = true; el.innerHTML = ""; document.body.classList.remove("onb-open"); import("./more.js").then(m => m.openAuth("in")); return; }
  if (t.closest("[data-done]")) { close(); return; }
  if (t.closest("[data-switch]")) { st.mode = st.mode === "up" ? "in" : "up"; again(); return; }
  const lg = t.closest("[data-lang]"); if (lg) { st.lang = lg.dataset.lang; store.updateSettings({ voiceLang: st.lang === "fi" ? "fi-FI" : "en-GB" }); again(); setTimeout(() => { if (id() === "lang") next(false); }, 320); return; }
  const ai = t.closest("[data-ai]"); if (ai) { setConsent({ ai: ai.dataset.ai === "yes" }); if (step >= steps().length - 1) close(); else advance(); return; }   // signed in already: privacy is the last step
  const ed = t.closest("[data-edit]"); if (ed) { keepRows(); st.back = "summary"; go(ed.dataset.edit); dir = -1; paint(); return; }
  const fe = t.closest("[data-feel]"); if (fe) { const v = fe.dataset.feel; st.feel.has(v) ? st.feel.delete(v) : st.feel.add(v); again(v); return; }
  const tn = t.closest("[data-tone]"); if (tn) { st.tone = Number(tn.dataset.tone); $$("[data-tone]", el).forEach(x => x.setAttribute("aria-checked", x === tn)); const w = $(".onb-wave", el); if (w) w.textContent = hand("\u{1F44B}"); return; }
  const w = t.closest("[data-why]"); if (w) { const v = w.dataset.why; st.why.has(v) ? st.why.delete(v) : st.why.add(v); again(v); return; }
  if (t.closest("[data-addbill]")) { st.adding = true; again(); return; }
  if (t.closest("[data-savebill]")) { addBill(); return; }
  const b = t.closest("[data-bill]"); if (b) { const n = b.dataset.bill; st.picked.has(n) ? st.picked.delete(n) : st.picked.add(n); again(n); return; }
  const g = t.closest("[data-goal]"); if (g) { st.goal = st.goal === g.dataset.goal ? null : g.dataset.goal; again(st.goal); return; }
  const n = t.closest("[data-nudge]"); if (n) { st.nudge[n.dataset.nudge] = !st.nudge[n.dataset.nudge]; n.setAttribute("aria-checked", st.nudge[n.dataset.nudge]); return; }
  const p = t.closest("[data-pick]");
  if (p) {
    const v = p.dataset.pick, s = id();
    if (s === "pay") { st.when = isNaN(Number(v)) ? v : Number(v); $("#obDayRow", el).hidden = st.when !== "date"; }
    else if (s === "goalWhen") { st.by = v; $("#obByRow", el).hidden = v !== "date"; }
    else st[s] = v;
    $$("[data-pick]", p.parentElement).forEach(x => x.setAttribute("aria-checked", x === p));
    if (s === "people") setTimeout(() => { if (id() === s) next(false); }, 320);   // one choice: on to the next question
    return;
  }
  if (t.closest("[data-back]")) { keepRows(); if (st.back) { go(st.back); st.back = null; } else step--; dir = -1; paint(); return; }
  if (t.closest("[data-later]")) { keepRows(); next(true); return; }
  if (t.closest("[data-next]")) { keepRows(); next(false); }
}
/* Their own bill (not in the list): it becomes a chip, already picked, with its amount and day to fill in. */
function addBill() {
  keepRows();
  const name = String(st.newBill || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!name) { st.adding = false; dir = 0; paint(); return; }
  const same = allBills().find(x => x.toLowerCase() === name.toLowerCase());
  if (!same) st.custom.push(name);
  st.picked.add(same || name); st.newBill = ""; st.adding = false; st.just = same || name; dir = 0; paint(); st.just = null;
}
/* After their name: their hand (in their tone) and Koti's meet and shake, "Nice to meet you, Antti", then on. */
function shake() {
  el.insertAdjacentHTML("beforeend", `<div class="onb-shake" role="status"><div class="onb-hands" aria-hidden="true"><span class="h-you">${hand("\u{1FAF1}")}</span><span class="h-koti">\u{1FAF2}</span></div><p>${L().meet(first())}</p></div>`);
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(advance, reduce ? 1100 : 2000);
}
/* On to the next step, or back to the summary when they came from it to change something. */
function advance() { if (st.back && !(id() === "goal" && st.goal)) { go(st.back); st.back = null; } else step++; dir = 1; paint(); }   // a goal changed from the summary: its date next, then back
/* What they told Koti, as a profile Koti reads with every question (settings.profile). */
const saveProfile = patch => store.updateSettings({ profile: { ...(store.model.settings.profile || {}), ...patch, at: new Date().toISOString().slice(0, 10) } });
function msg(t) { const m = $("#obMsg", el); if (m) m.textContent = t; }
function keepRows() {
  const v = sel => { const x = $(sel, el); return x ? x.value : null; };
  if (v("#obAmt") != null) st.amount = v("#obAmt");
  if (v("#obDay") != null) st.day = Number(v("#obDay"));
  if (v("#obBal") != null) st.balance = v("#obBal");
  if (v("#obGoalAmt") != null) st.goalAmt = v("#obGoalAmt");
  if (v("#obByMonth") != null) st.byMonth = v("#obByMonth");
  if (v("#obName") != null) st.name = v("#obName");
  if (v("#obNewBill") != null) st.newBill = v("#obNewBill");
  if (v("#obEmail") != null) st.email = v("#obEmail").trim();
  $$("[data-amt]", el).forEach(i => { st.amounts[i.dataset.amt] = i.value; });
  $$("[data-dday]", el).forEach(s => { st.days[s.dataset.dday] = Number(s.value); });
}

function next(later) {
  const s = id(), T = L();
  if (s === "lang") saveProfile({ lang: st.lang });
  if (s === "why" && !later && st.why.size) {
    saveProfile({ why: [...st.why] });
    remember(T.whyMem(T.WHY.filter(([v]) => st.why.has(v)).map(([, , m]) => m).join(", ")));
  }
  if (s === "pay" && !later) {
    const amount = parseMoney(st.amount);
    if (st.when !== "varies" && (!amount || Number.isNaN(amount))) return msg(T.payErr);
    const payDay = st.when === "date" ? st.day : st.when === "varies" ? LAST_DAY : st.when;
    st.ids.income = store.put("income", { id: st.ids.income, name: T.salary, amount: amount || null, frequency: st.when === "varies" ? "varies" : "monthly", payDay, active: true, position: store.model.income.length }).id;
  }
  if (s === "bills" && !later) {
    const missing = [...st.picked].filter(n => { const v = parseMoney(st.amounts[n]); return !v || Number.isNaN(v); });
    if (missing.length) return msg(T.billsErr(missing.join(", ")));
    if (st.picked.size) saveProfile({ bills: st.picked.size });
    [...st.picked].forEach((n, k) => { st.ids["b:" + n] = store.put("bills", { id: st.ids["b:" + n], name: n, amount: parseMoney(st.amounts[n]), frequency: "monthly", dueDay: st.days[n] || 1, anchorMonth: new Date().getMonth() + 1, startDate: (st.days[n] || 1) < new Date().getDate() ? nextMonthStart() : null, active: true, position: store.model.bills.length + k }).id; });
  }
  if (s === "nudges" && !later) {
    const R = store.model.settings.reminders || {};
    store.updateSettings({ reminders: { ...R, bills: st.nudge.bills, payday: st.nudge.payday, weekly: st.nudge.weekly } });
    saveProfile({ nudges: { ...st.nudge } });
  }
  if (s === "name") {
    const name = String(st.name || "").trim().slice(0, 40);
    if (!later && !name) return msg(T.nameErr);
    if (name) store.updateSettings({ name, skinTone: st.tone });
    if (name && !later) { shake(); return; }
  }
  if (s === "balance" && !later) {
    const raw = st.balance, v = parseMoney(raw);
    if (v == null || Number.isNaN(v)) return msg(T.balErr);
    setBalanceNow(/^\s*-/.test(raw) ? -v : v);
  }
  if (s === "feel" && !later && st.feel.size) {
    saveProfile({ feel: [...st.feel] });
    T.FEEL.filter(([v]) => st.feel.has(v)).forEach(([, , m]) => remember(m));
  }
  if (s === "people" && !later && st.people) { saveProfile({ people: st.people }); remember(T.PEOPLE.find(([v]) => v === st.people)[2]); }
  if (s === "goal" && !later && st.goal) {
    const target = parseMoney(st.goalAmt);
    if (st.goalAmt && (target == null || Number.isNaN(target) || target <= 0)) return msg(T.goalErr);
    const name = T.GOALS[GOALS.indexOf(st.goal)] || st.goal;
    saveProfile({ goal: { name: st.goal, target: target || null } });
    st.ids.goal = store.put("goals", { id: st.ids.goal, name, target: target || null, saved: 0, monthly: null, targetDate: null, position: store.model.goals.length }).id;
  }
  if (s === "goalWhen" && !later && st.by && st.ids.goal) {
    const target = parseMoney(st.goalAmt) || null, now = new Date();
    let months = st.by === "none" ? null : st.by === "date" ? null : Number(st.by), by = null, monthly = null;
    if (st.by === "date") {
      const [y, m] = String(st.byMonth || "").split("-").map(Number);
      months = y && m ? (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()) : 0;
      if (!(months >= 1)) return msg(T.byErr);
    }
    if (months) ({ by, monthly } = goalBy(months, target, now));
    const g = store.model.goals.find(x => x.id === st.ids.goal);
    if (g) store.put("goals", { ...g, targetDate: by, monthly });
    saveProfile({ goal: { ...(store.model.settings.profile || {}).goal, by, monthly } });
  }
  if (s === "summary") st.back = null;
  if (s === "account") { if (later) { close(); return; } return account(); }
  advance();
}

/* The last step: create the account (or sign in to one). What was answered on this phone goes with it. */
async function account() {
  const T = L(), email = st.email, pw = ($("#obPass", el) || {}).value || "", btn = $("[data-next]", el);
  if (!/^\S+@\S+\.\S+$/.test(email)) return msg(T.eMail);
  if (pw.length < 8) return msg(T.ePw);
  btn.disabled = true; msg(""); btn.textContent = st.mode === "up" ? T.creating : T.signingIn;
  try {
    if (st.mode === "up") { const r = await signUp(email, pw); if (r.needsConfirm) { st.sent = true; dir = 0; paint(); return; } }
    else await signIn(email, pw);
    close(); toast(st.mode === "up" ? T.madeT : T.inT);
  } catch (err) {
    const m = String(err.message || err);
    btn.disabled = false; btn.textContent = st.mode === "up" ? T.create : T.signin;
    msg(/Invalid login/i.test(m) ? T.eLogin : /Email not confirmed/i.test(m) ? T.eConfirm : /already registered/i.test(m) ? T.eTaken : /fetch|network/i.test(m) ? T.eNet : m);
  }
}
