const ArticleMessage = require('./ArticleMessage.js')
const config = require('../config.js')
const storage = require('../util/storage.js')
const log = require('../util/logger.js')

function toggleRoleMentionable (mentionable, channelId, roleIds, callback) {
  if (roleIds.length === 0) return callback ? callback() : null
  let done = 0
  const channel = storage.bot.channels.get(channelId)
  if (!channel) return callback ? callback() : null
  const guild = channel.guild
  for (var x = roleIds.length - 1; x >= 0; --x) {
    const role = guild.roles.get(roleIds[x])
    // Other checks may include guild.me.highestRole.comparePositionTo(role) <= 0, and whether the bot has manage roles permission, but don't check them and let the error show in the message
    if (!role || role.mentionable === mentionable) { 
      if (++done >= roleIds.length) return callback ? callback() : null
      continue
    }
    role.setMentionable(mentionable).then(r => {
      if (++done >= roleIds.length && callback) callback()
    }).catch(err => {
      log.general.error(`Unable to toggle role ${role.id} (${role.name}) mentionable to ${mentionable} for article delivery`, guild, err)
      if (++done >= roleIds.length && callback) callback(err.code === 50013 ? new Error(err.message + ` (Name: ${role.name}, ID: ${role.id}`) : null)
    })
  }
}

class ArticleMessageQueue {
  constructor () {
    this.queues = {} // Object of objects (mapped by channel ID) with keys length and queue
    this.queuesWithSubs = {}
  }

  async send (article, isTestMessage, skipFilters) {
    if (config._skipMessages === true) return
    const articleMessage = new ArticleMessage(article, isTestMessage, skipFilters)
    await this._pushNext(articleMessage)
  }

  async _pushNext (articleMessage) {
    const delayArticleMessage = articleMessage.toggleRoleMentions && articleMessage.subscriptionIds.length > 0
    const channelId = articleMessage.channelId
    const queues = delayArticleMessage ? this.queuesWithSubs : this.queues
    if (!queues[channelId]) queues[channelId] = [articleMessage]
    else queues[channelId].push(articleMessage)
    if (!delayArticleMessage) await this._sendNext(articleMessage.channelId)
  }

  async _sendNext (channelId) {
    const channelQueue = this.queues[channelId]
    if (channelQueue.length === 0) return
    const articleMessage = channelQueue.shift()
    await articleMessage.send()
    await this._sendNext(channelId)
  }

  sendDelayed () {
    for (var channelId in this.queuesWithSubs) {
      const channelQueue = this.queuesWithSubs[channelId]
      if (channelQueue.length === 0) continue
      const cId = channelId
      let roleIds = []
      for (var x = 0; x < channelQueue.length; ++x) {
        const messageSubscriptionIds = channelQueue[x].subscriptionIds
        messageSubscriptionIds.forEach(id => {
          if (!roleIds.includes(id)) roleIds.push(id)
        })
      }
      toggleRoleMentionable(true, cId, roleIds, err => {
        this._sendDelayedQueue(cId, channelQueue, roleIds, err)
      })
    }
  }

  async _sendDelayedQueue (channelId, channelQueue, roleIds, err) {
    const articleMessage = channelQueue.shift()
    try {
      if (err) articleMessage.text += `\n\nFailed to toggle role mentions: ${err.message}`
      await articleMessage.send()
      if (channelQueue.length === 0) toggleRoleMentionable(false, channelId, roleIds)
      else this._sendDelayedQueue(channelId, channelQueue, roleIds, err)
    } catch (err) {
      log.general.error('Failed to send a delayed articleMessage', err, articleMessage.channel ? articleMessage.channel.guild : undefined, true)
    }
  }
}

module.exports = ArticleMessageQueue
