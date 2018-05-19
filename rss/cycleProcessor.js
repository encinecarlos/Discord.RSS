/*
  Each batch of link maps (of length batchSize) in a batchList will have a forked rssProcessor
*/
const FeedParser = require('feedparser')
const requestStream = require('./request.js')
const connectDb = require('./db/connect.js')
const logLinkErr = require('../util/logLinkErrs.js')
const processAllSources = require('./logic/cycle.js')
const log = require('../util/logger.js')

function getFeed (data) {
  const { link, rssList, uniqueSettings } = data
  const feedparser = new FeedParser()
  const articleList = []

  const cookies = (uniqueSettings && uniqueSettings.cookies) ? uniqueSettings.cookies : undefined
  let requested = false

  setTimeout(() => {
    if (!requested) {
      try {
        process.send({ status: 'failed', link: link, rssList: rssList })
        log.cycle.error(`Unable to complete request for link ${link} during cycle, forcing status update to parent process`)
      } catch (e) {}
    }
  }, 90000)

  requestStream(link, cookies, feedparser, err => {
    requested = true
    if (!err) return
    logLinkErr({link: link, content: err})
    process.send({ status: 'failed', link: link, rssList: rssList })
  })

  feedparser.on('error', err => {
    logLinkErr({link: link, content: err})
    process.send({ status: 'failed', link: link, rssList: rssList })
    feedparser.removeAllListeners('end')
  })

  feedparser.on('readable', function () {
    let item
    do {
      item = this.read()
      if (item) articleList.push(item)
    } while (item)
  })

  feedparser.on('end', () => {
    if (articleList.length === 0) return process.send({status: 'success', link: link})

    processAllSources({ articleList: articleList, ...data }, (err, results) => {
      if (err) log.cycle.error(`Cycle logic`, err)
      if (results) process.send(results)
    })
  })
}

process.on('message', m => {
  const currentBatch = m.currentBatch
  const shardId = m.shardId
  const debugFeeds = m.debugFeeds
  connectDb(err => {
    if (err) throw new Error(`Could not connect to database for cycle.\n`, err)
    for (var link in currentBatch) {
      const rssList = currentBatch[link]
      let uniqueSettings
      for (var modRssName in rssList) {
        if (rssList[modRssName].advanced && Object.keys(rssList[modRssName].advanced).length > 0) {
          uniqueSettings = rssList[modRssName].advanced
        }
      }
      getFeed({ link, rssList, uniqueSettings, debugFeeds, shardId })
    }
  })
})
