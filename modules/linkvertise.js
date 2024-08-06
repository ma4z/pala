const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");

/* Ensure platform release target is met */
const plexactylModule = { "name": "Linkvertise", "target_platform": "18.0.x" };

/* Module */
module.exports.plexactylModule = plexactylModule;
module.exports.load = async function(app, db) {

  const lvcodes = {}
  const cooldowns = {}

  app.get(`/cp/lv/gen`, async (req, res) => {
      if (!req.session.pterodactyl) return res.redirect("/login");

      if (cooldowns[req.session.userinfo.id] && cooldowns[req.session.userinfo.id] > Date.now()) {
          return res.redirect(`/cp/lv`)
      } else if (cooldowns[req.session.userinfo.id]) {
          delete cooldowns[req.session.userinfo.id]
      }

      const dailyTotal = await db.get(`dailylinkvertise-${req.session.userinfo.id}`)
      if (dailyTotal && dailyTotal >= settings.linkvertise.dailyLimit) {
          return res.redirect(`/cp/lv?err=REACHEDDAILYLIMIT`)
      }

      let referer = req.headers.referer
      if (!referer) return res.send('An error occured with your browser!')
      referer = referer.toLowerCase()
      if (referer.includes('?')) referer = referer.split('?')[0]
      if (!referer.endsWith(`/lv`) && !referer.endsWith(`/lv/`)) return res.send('An error occured with your browser!')
      if (!referer.endsWith(`/`)) referer += `/`

      const code = makeid(12)
      const lvurl = linkvertise(settings.linkvertise.userid, referer + `redeem?code=${code}`)

      lvcodes[req.session.userinfo.id] = {
          code: code,
          user: req.session.userinfo.id,
          generated: Date.now()
      }

      res.redirect(lvurl)
  })

  app.get(`/cp/lv/redeem`, async (req, res) => {
      if (!req.session.pterodactyl) return res.redirect("/");

      if (cooldowns[req.session.userinfo.id] && cooldowns[req.session.userinfo.id] > Date.now()) {
          return res.redirect(`/cp/lv`)
      } else if (cooldowns[req.session.userinfo.id]) {
          delete cooldowns[req.session.userinfo.id]
      }

      const code = req.query.code
      if (!code) return res.send('An error occured with your browser!')
      if (!req.headers.referer || !req.headers.referer.includes('linkvertise.com')) return res.redirect('/cp/lv?err=BYPASSER')

      const usercode = lvcodes[req.session.userinfo.id]
      if (!usercode) return res.redirect(`/cp/lv`)
      if (usercode.code !== code) return res.redirect(`/cp/lv`)
      delete lvcodes[req.session.userinfo.id]

      // Checking at least the minimum allowed time passed between generation and completion
      if (((Date.now() - usercode.generated) / 1000) < settings.linkvertise.minTimeToComplete) {
          return res.redirect('/cp/lv?err=BYPASSER')
      }

      cooldowns[req.session.userinfo.id] = Date.now() + (settings.linkvertise.cooldown * 1000)

      // Adding to daily total
      const dailyTotal = await db.get(`dailylinkvertise-${req.session.userinfo.id}`)
      if (dailyTotal && dailyTotal >= settings.linkvertise.dailyLimit) {
          return res.redirect(`/cp/lv?err=REACHEDDAILYLIMIT`)
      }
      if (dailyTotal) await db.set(`dailylinkvertise-${req.session.userinfo.id}`, dailyTotal + 1)
      else await db.set(`dailylinkvertise-${req.session.userinfo.id}`, 1)
      if (dailyTotal + 1 >= settings.linkvertise.dailyLimit) {
          await db.set(`lvlimitdate-${req.session.userinfo.id}`, Date.now(), 43200000)
      }

      // Adding coins
      const coins = await db.get(`coins-${req.session.userinfo.id}`)
      await db.set(`coins-${req.session.userinfo.id}`, coins + settings.linkvertise.coins)

      res.redirect(`/cp/lv?err=none`)
  })
  
  app.get(`/api/lvcooldown`, async (req, res) => {
      if (!req.session.pterodactyl) return res.json({ error: true, message: 'Not logged in' })

      const limitTimestamp = await db.get(`lvlimitdate-${req.session.userinfo.id}`)
      if (limitTimestamp) {
          if ((limitTimestamp + 43200000) < Date.now()) {
              db.delete(`dailylinkvertise-${req.session.userinfo.id}`)
              await db.delete(`lvlimitdate-${req.session.userinfo.id}`)
          } else {
              return res.json({ dailyLimit: true, readable: msToHoursAndMinutes((limitTimestamp + 43200000) - Date.now()) })
          }
      }

      if (cooldowns[req.session.userinfo.id] && cooldowns[req.session.userinfo.id] < Date.now()) {
          delete cooldowns[req.session.userinfo.id]
      }

      return res.json({ cooldown: cooldowns[req.session.userinfo.id] ?? null })
  })

  // Removing codes that have expired and cooldowns that are no longer applicable
  setInterval(() => {
      for (const code of Object.values(lvcodes)) {
          if (((Date.now() - code.generated) / 1000) > settings.linkvertise.timeToExpire) {
              delete lvcodes[code.user]
          }
      }

      for (const user of Object.keys(cooldowns)) {
          const cooldown = cooldowns[user]
          if (cooldown < Date.now()) delete cooldowns[user]
      }
  }, 10000)

}

function linkvertise(userid, link) {
  var base_url = `https://link-to.net/${userid}/${Math.random() * 1000}/dynamic`;
  var href = base_url + "?r=" + btoa(encodeURI(link));
  return href;
}

function btoa(str) {
  var buffer;

  if (str instanceof Buffer) {
      buffer = str;
  } else {
      buffer = Buffer.from(str.toString(), "binary");
  }
  return buffer.toString("base64");
}

function makeid(length) {
  let result = '';
  let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

function msToHoursAndMinutes(ms) {
  const msInHour = 3600000
  const msInMinute = 60000

  const hours = Math.floor(ms / msInHour)
  const minutes = Math.round((ms - (hours * msInHour)) / msInMinute * 100) / 100

  let pluralHours = `s`
  if (hours === 1) {
      pluralHours = ``
  }
  let pluralMinutes = `s`
  if (minutes === 1) {
      pluralMinutes = ``
  }

  return `${hours} hour${pluralHours} and ${minutes} minute${pluralMinutes}`
}