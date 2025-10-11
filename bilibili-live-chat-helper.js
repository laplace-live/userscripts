// ==UserScript==
// @name         LAPLACE 弹幕助手 - 哔哩哔哩直播间独轮车、弹幕发送
// @namespace    https://greasyfork.org/users/1524935
// @version      2.0.2
// @description  这是 bilibili 直播间简易版独轮车，基于 quiet/thusiant cmd 版本 https://greasyfork.org/scripts/421507 继续维护而来
// @author       laplace-live
// @license      AGPL-3.0
// @icon         https://laplace.live/favicon.ico
// @match        *://live.bilibili.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// ==/UserScript==

/** @type {string[]} */
const MsgTemplates = GM_getValue('MsgTemplates', [])

/** @type {number} */
let activeTemplateIndex = GM_getValue('activeTemplateIndex', 0)

/** @type {Object.<string, number|boolean>} */
const scriptInitVal = {
  msgSendInterval: 1,
  maxLength: 20,
  maxLogLines: 1000,
  randomColor: false,
  randomInterval: false,
  randomChar: false,
}

for (const initVal in scriptInitVal) {
  if (GM_getValue(initVal) === undefined) GM_setValue(initVal, scriptInitVal[initVal])
}

/** @type {boolean} */
let sendMsg = false

/**
 * Splits a string into grapheme clusters (user-perceived characters)
 * @param {string} str - The string to split into graphemes
 * @returns {string[]} An array of grapheme clusters
 */
function getGraphemes(str) {
  const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' })
  return Array.from(segmenter.segment(str), ({ segment }) => segment)
}

/**
 * Emoji-safe splitting text into parts based on maximum grapheme length
 * @param {string} text - The text to split
 * @param {number} maxLength - Maximum number of graphemes per part
 * @returns {string[]} An array of text parts, each within the maxLength
 */
function trimText(text, maxLength) {
  if (!text) return [text]

  const graphemes = getGraphemes(text)
  if (graphemes.length <= maxLength) return [text]

  const parts = []
  let currentPart = []
  let currentLength = 0

  for (const char of graphemes) {
    if (currentLength >= maxLength) {
      parts.push(currentPart.join(''))
      currentPart = [char]
      currentLength = 1
    } else {
      currentPart.push(char)
      currentLength++
    }
  }

  if (currentPart.length > 0) {
    parts.push(currentPart.join(''))
  }

  return parts
}

/**
 * Appends a message to a textarea log with a maximum line limit
 * @param {HTMLTextAreaElement} logElement - The textarea element to append to
 * @param {string} message - The message to append
 * @param {number} maxLines - Maximum number of lines to keep in the log
 * @returns {void}
 */
function appendToLimitedLog(logElement, message, maxLines) {
  const lines = logElement.value.split('\n')
  if (lines.length >= maxLines) {
    // Keep only the last (maxLines - 1) lines and add the new message
    lines.splice(0, lines.length - maxLines + 1)
  }
  lines.push(message)
  logElement.value = lines.join('\n')
  logElement.scrollTop = logElement.scrollHeight
}

/**
 * Extracts the room number from a Bilibili live room URL
 * @param {string} url - The URL to extract the room number from
 * @returns {string|undefined} The room number, or undefined if not found
 */
function extractRoomNumber(url) {
  const urlObj = new URL(url)
  const pathSegments = urlObj.pathname.split('/').filter(segment => segment !== '')
  const roomNumber = pathSegments.find(segment => Number.isInteger(Number(segment)))
  return roomNumber
}

/**
 * Adds a random soft hyphen character at a random position in the text
 * @param {string} text - The text to modify
 * @returns {string} The modified text with a random character inserted
 */
function addRandomCharacter(text) {
  if (!text || text.length === 0) return text

  const graphemes = getGraphemes(text)
  const randomIndex = Math.floor(Math.random() * (graphemes.length + 1))
  graphemes.splice(randomIndex, 0, '­')
  return graphemes.join('')
}

/**
 * Processes messages by splitting lines, optionally adding random characters, and trimming to max length
 * @param {string} text - The text containing messages (one per line)
 * @param {number} maxLength - Maximum grapheme length per message
 * @param {boolean} [addRandomChar=false] - Whether to add random characters to each line
 * @returns {string[]} An array of processed message strings
 */
function processMessages(text, maxLength, addRandomChar = false) {
  return text
    .split('\n')
    .flatMap(line => {
      // Add random character if enabled
      if (addRandomChar && line && line.trim()) {
        line = addRandomCharacter(line)
      }
      // Then trim based on maxLength
      return trimText(line, maxLength)
    })
    .filter(line => line?.trim())
}

/** @type {number|null} */
let cachedRoomId = null

/** @type {Function|null} */
let onRoomIdReadyCallback = null

/** @type {Map<string, string>|null} */
let replacementMap = null

;(() => {
  const check = setInterval(() => {
    /** @type {HTMLDivElement} */
    const toggleBtn = document.createElement('div')
    toggleBtn.id = 'toggleBtn'
    toggleBtn.textContent = '弹幕助手'
    toggleBtn.style.cssText = `
      position: fixed;
      right: 4px;
      bottom: 4px;
      z-index: 2147483647;
      cursor: pointer;
      background: #777;
      color: white;
      padding: 6px 8px;
      border-radius: 4px;
      user-select: none;
    `
    document.body.appendChild(toggleBtn)

    /** @type {HTMLDivElement} */
    const list = document.createElement('div')
    list.style.cssText = `
      position: fixed;
      right: 4px;
      bottom: calc(4px + 30px);
      z-index: 2147483647;
      background: white;
      display: none;
      padding: 10px;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, .2);
      border-radius: 4px;
      min-width: 50px;
      max-height: calc(100vh - 64px);
      overflow-y: auto;
      width: 300px;
    `

    list.innerHTML = `<div>
      <!-- Tab Navigation -->
      <div style="display: flex; margin-block: -5px .75em; margin-inline: -10px; padding: 0 10px; gap: .25em; border-bottom: 1px solid #ddd;">
        <button id="tab-dulunche" class="tab-btn" style="padding: .25em .75em; margin-bottom: -1px; border: none; background: none; cursor: pointer; border-bottom: 1px solid transparent;">独轮车</button>
        <button id="tab-fasong" class="tab-btn" style="padding: .25em .75em; margin-bottom: -1px; border: none; background: none; cursor: pointer; border-bottom: 1px solid transparent;">常规发送</button>
        <button id="tab-settings" class="tab-btn" style="padding: .25em .75em; margin-bottom: -1px; border: none; background: none; cursor: pointer; border-bottom: 1px solid transparent;">设置</button>
      </div>

      <!-- Tab Content: 独轮车 -->
      <div id="content-dulunche" class="tab-content" style="display: none;">
        <div style="margin: .5em 0; display: flex; align-items: center; flex-wrap: wrap; gap: .25em;">
          <button id="sendBtn">开启独轮车</button>
          <select id="templateSelect" style="width: 16ch;"></select>
          <button id="addTemplateBtn">新增</button>
          <button id="removeTemplateBtn">删除当前</button>
        </div>
        <textarea id="msgList" placeholder="在这输入弹幕，每行一句话，超过可发送字数的会自动进行分割" style="box-sizing: border-box; height: 100px; width: 100%; resize: vertical;"></textarea>
        <div style="margin: .5em 0;">
          <span id="msgCount"></span><span>间隔</span>
          <input id="msgSendInterval" style="width: 30px;" autocomplete="off" type="number" min="0" value="${GM_getValue('msgSendInterval')}" />
          <span>秒，</span>
          <span>超过</span>
          <input id="maxLength" style="width: 30px;" autocomplete="off" type="number" min="1" value="${GM_getValue('maxLength')}" />
          <span>字自动分段，</span>
          <span style="display: inline-flex; align-items: center; gap: .25em;">
            <input id="randomColor" type="checkbox" ${GM_getValue('randomColor') ? 'checked' : ''} />
            <label for="randomColor">随机颜色</label>
          </span>
          <span style="display: inline-flex; align-items: center; gap: .25em;">
            <input id="randomInterval" type="checkbox" ${GM_getValue('randomInterval') ? 'checked' : ''} />
            <label for="randomInterval">间隔增加随机性</label>
          </span>
          <span style="display: inline-flex; align-items: center; gap: .25em;">
            <input id="randomChar" type="checkbox" ${GM_getValue('randomChar') ? 'checked' : ''} />
            <label for="randomChar">随机字符</label>
          </span>
        </div>
      </div>

      <!-- Tab Content: 发送 -->
      <div id="content-fasong" class="tab-content" style="display: none;">
        <div style="margin: .5em 0;">
          <textarea id="fasongInput" placeholder="输入弹幕内容… (Enter 发送)" style="box-sizing: border-box; height: 50px; width: 100%; resize: vertical;"></textarea>
        </div>
      </div>

      <!-- Tab Content: 全局设置 -->
      <div id="content-settings" class="tab-content" style="display: none;">
        <!-- Remote Keyword Sync -->
        <div style="margin: .5em 0; padding-bottom: .5em; border-bottom: 1px solid #eee;">
          <div style="font-weight: bold; margin-bottom: .5em;">
            云端规则替换
            <a href="https://github.com/laplace-live/public/blob/master/artifacts/livesrtream-keywords.json" target="_blank" style="color: #288bb8; text-decoration: none;">我要贡献规则</a>
          </div>
          <div style="margin-block: .5em; color: #666;">
            每15分钟会自动同步云端替换规则
          </div>
          <div style="display: flex; gap: .5em; align-items: center; flex-wrap: wrap; margin-bottom: .5em;">
            <button id="syncRemoteBtn" style="padding: .25em .75em;">同步</button>
            <span id="remoteKeywordsStatus" style="color: #666;">未同步</span>
          </div>
          <div id="remoteKeywordsInfo" style="color: #666;"></div>
        </div>

        <!-- Local Replacement Rules -->
        <div style="margin: .5em 0;">
          <div style="font-weight: bold; margin-bottom: .5em;">本地规则替换</div>
          <div style="margin-block: .5em; color: #666;">规则从上至下执行；本地规则总是最后执行</div>
          <div id="replacementRulesList" style="margin-bottom: .5em; max-height: 160px; overflow-y: auto;"></div>
          <div style="display: flex; gap: .25em; align-items: center; flex-wrap: wrap;">
            <input id="replaceFrom" placeholder="替换前" style="flex: 1; min-width: 80px;" />
            <span>→</span>
            <input id="replaceTo" placeholder="替换后" style="flex: 1; min-width: 80px;" />
            <button id="addRuleBtn" style="padding: .25em .5em;">添加</button>
          </div>
        </div>
      </div>

      <!-- Global Log Area -->
      <details style="margin-top: .25em;">
        <summary style="cursor: pointer; user-select: none; font-weight: bold;">日志</summary>
        <textarea id="msgLogs" style="box-sizing: border-box; height: 80px; width: 100%; resize: vertical; margin-top: .5em;" placeholder="此处将输出日志（最多保留 ${GM_getValue('maxLogLines')} 条）" readonly></textarea>
      </details>
      </div>`

    document.body.appendChild(list)

    // Tab switching logic
    /** @type {string} */
    const activeTab = GM_getValue('activeTab', 'dulunche')

    /**
     * Switches to the specified tab and saves the state
     * @param {string} tabId - The tab identifier (dulunche or fasong)
     * @returns {void}
     */
    function switchTab(tabId) {
      // Hide all tab contents
      document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none'
      })

      // Remove active state from all tabs
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.style.borderBottom = '1px solid transparent'
        btn.style.fontWeight = 'normal'
      })

      // Show selected tab content
      const contentElement = document.getElementById(`content-${tabId}`)
      if (contentElement) {
        contentElement.style.display = 'block'
      }

      // Highlight active tab button
      const tabBtn = document.getElementById(`tab-${tabId}`)
      if (tabBtn) {
        tabBtn.style.borderBottom = '1px solid #36a185'
        tabBtn.style.fontWeight = 'bold'
      }

      // Save active tab
      GM_setValue('activeTab', tabId)
    }

    // Setup tab click handlers
    document.getElementById('tab-dulunche')?.addEventListener('click', () => {
      switchTab('dulunche')
    })

    document.getElementById('tab-fasong')?.addEventListener('click', () => {
      switchTab('fasong')
    })

    document.getElementById('tab-settings')?.addEventListener('click', () => {
      switchTab('settings')
    })

    // Restore last active tab
    switchTab(activeTab)

    /** @type {HTMLButtonElement} */
    const sendBtn = document.getElementById('sendBtn')
    /** @type {HTMLTextAreaElement} */
    const msgLogs = document.getElementById('msgLogs')
    /** @type {number} */
    const maxLogLines = GM_getValue('maxLogLines')

    sendBtn.addEventListener('click', () => {
      if (!sendMsg) {
        const currentTemplate = MsgTemplates[activeTemplateIndex] || ''
        if (!currentTemplate.trim()) {
          appendToLimitedLog(msgLogs, '⚠️ 当前模板为空，请先输入内容', maxLogLines)
          return
        }

        updateMessages()
        sendMsg = true
        sendBtn.textContent = '关闭独轮车'
        toggleBtn.style.background = 'rgb(0 186 143)'
      } else {
        sendMsg = false
        sendBtn.textContent = '开启独轮车'
        toggleBtn.style.background = 'rgb(166 166 166)'
      }
    })

    toggleBtn.addEventListener('click', () => {
      list.style.display = list.style.display === 'none' ? 'block' : 'none'
    })

    /** @type {HTMLTextAreaElement} */
    const msgInput = document.getElementById('msgList')
    /** @type {HTMLSpanElement} */
    const msgCount = document.getElementById('msgCount')
    /** @type {HTMLInputElement} */
    const msgIntervalInput = document.getElementById('msgSendInterval')
    /** @type {HTMLInputElement} */
    const maxLengthInput = document.getElementById('maxLength')
    /** @type {HTMLInputElement} */
    const randomColorInput = document.getElementById('randomColor')
    /** @type {HTMLInputElement} */
    const randomIntervalInput = document.getElementById('randomInterval')
    /** @type {HTMLInputElement} */
    const randomCharInput = document.getElementById('randomChar')
    /** @type {HTMLSelectElement} */
    const templateSelect = document.getElementById('templateSelect')
    /** @type {HTMLButtonElement} */
    const addTemplateBtn = document.getElementById('addTemplateBtn')
    /** @type {HTMLButtonElement} */
    const removeTemplateBtn = document.getElementById('removeTemplateBtn')

    /**
     * Updates the current template with input content and refreshes message count
     * @returns {void}
     */
    function updateMessages() {
      const maxLength = parseInt(maxLengthInput.value, 10) || 20
      MsgTemplates[activeTemplateIndex] = msgInput.value
      GM_setValue('MsgTemplates', MsgTemplates)
      const Msg = processMessages(msgInput.value, maxLength)
      msgCount.textContent = `${Msg.length || 0} 条，`
    }

    /**
     * Updates the template select dropdown with current templates
     * @returns {void}
     */
    function updateTemplateSelect() {
      templateSelect.innerHTML = ''
      MsgTemplates.forEach((template, index) => {
        const option = document.createElement('option')
        option.value = index

        // Get first line of template and truncate to 20 characters
        const firstLine = template.split('\n')[0].trim()
        const preview = firstLine
          ? getGraphemes(firstLine).length > 10
            ? `${trimText(firstLine, 10)[0]}...`
            : firstLine
          : '(空)'

        option.textContent = `${index + 1}: ${preview}`
        templateSelect.appendChild(option)
      })
      templateSelect.value = activeTemplateIndex
      msgInput.value = MsgTemplates[activeTemplateIndex] || ''
      updateMessages()
    }

    templateSelect.addEventListener('change', () => {
      activeTemplateIndex = parseInt(templateSelect.value, 10)
      GM_setValue('activeTemplateIndex', activeTemplateIndex)
      msgInput.value = MsgTemplates[activeTemplateIndex] || ''
      updateMessages()
    })

    addTemplateBtn.addEventListener('click', () => {
      MsgTemplates.push('')
      activeTemplateIndex = MsgTemplates.length - 1
      GM_setValue('MsgTemplates', MsgTemplates)
      GM_setValue('activeTemplateIndex', activeTemplateIndex)
      updateTemplateSelect()
    })

    removeTemplateBtn.addEventListener('click', () => {
      if (MsgTemplates.length > 1) {
        MsgTemplates.splice(activeTemplateIndex, 1)
        activeTemplateIndex = Math.max(0, activeTemplateIndex - 1)
        GM_setValue('MsgTemplates', MsgTemplates)
        GM_setValue('activeTemplateIndex', activeTemplateIndex)
        updateTemplateSelect()
      }
    })

    msgInput.addEventListener('input', () => {
      updateMessages()
      updateTemplateSelect()
    })

    msgIntervalInput.addEventListener('input', () => {
      if (!(parseInt(msgIntervalInput.value, 10) >= 0)) msgIntervalInput.value = 0
      GM_setValue('msgSendInterval', msgIntervalInput.value)
    })

    randomColorInput.addEventListener('input', () => {
      GM_setValue('randomColor', randomColorInput.checked)
    })

    randomIntervalInput.addEventListener('input', () => {
      GM_setValue('randomInterval', randomIntervalInput.checked)
    })

    randomCharInput.addEventListener('input', () => {
      GM_setValue('randomChar', randomCharInput.checked)
    })

    maxLengthInput.addEventListener('input', () => {
      const value = parseInt(maxLengthInput.value, 10)
      if (value < 1) maxLengthInput.value = 1
      GM_setValue('maxLength', maxLengthInput.value)
      updateMessages()
    })

    updateTemplateSelect()

    // ===== 发送 Tab Features =====
    /** @type {Array<{from: string, to: string}>} */
    const replacementRules = GM_getValue('replacementRules', [])

    /** @type {HTMLTextAreaElement} */
    const fasongInput = document.getElementById('fasongInput')
    /** @type {HTMLDivElement} */
    const replacementRulesList = document.getElementById('replacementRulesList')
    /** @type {HTMLInputElement} */
    const replaceFromInput = document.getElementById('replaceFrom')
    /** @type {HTMLInputElement} */
    const replaceToInput = document.getElementById('replaceTo')
    /** @type {HTMLButtonElement} */
    const addRuleBtn = document.getElementById('addRuleBtn')

    /**
     * Updates the display of replacement rules
     * @returns {void}
     */
    function updateReplacementRulesDisplay() {
      if (replacementRules.length === 0) {
        replacementRulesList.innerHTML = '<div style="color: #999;">暂无替换规则，请在下方添加</div>'
        return
      }

      replacementRulesList.innerHTML = replacementRules
        .map((rule, index) => {
          const fromDisplay = rule.from || '(空)'
          const toDisplay = rule.to || '(空)'
          return `
            <div style="display: flex; align-items: center; gap: .5em; padding: .2em; border-bottom: 1px solid #eee;">
              <span style="flex: 1; word-break: break-all; font-family: monospace;">${fromDisplay} → ${toDisplay}</span>
              <button class="remove-rule-btn" data-index="${index}" style="cursor: pointer; background: transparent; color: red; border: none; border-radius: 2px;">删除</button>
            </div>
          `
        })
        .join('')

      // Add event listeners to remove buttons
      document.querySelectorAll('.remove-rule-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          const index = parseInt(e.target.getAttribute('data-index'), 10)
          replacementRules.splice(index, 1)
          GM_setValue('replacementRules', replacementRules)
          buildReplacementMap() // Rebuild map when rules change
          updateReplacementRulesDisplay()
        })
      })
    }

    // Add new replacement rule
    addRuleBtn.addEventListener('click', () => {
      const from = replaceFromInput.value
      const to = replaceToInput.value

      if (!from) {
        appendToLimitedLog(msgLogs, '⚠️ 替换前的内容不能为空', maxLogLines)
        return
      }

      replacementRules.push({ from, to })
      GM_setValue('replacementRules', replacementRules)
      buildReplacementMap() // Rebuild map when rules change

      replaceFromInput.value = ''
      replaceToInput.value = ''

      updateReplacementRulesDisplay()
      // appendToLimitedLog(msgLogs, `✅ 已添加替换规则：${from} → ${to}`, maxLogLines);
    })

    // Allow Enter key to add rule in replace inputs
    replaceFromInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        addRuleBtn.click()
      }
    })

    replaceToInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        addRuleBtn.click()
      }
    })

    // Send message functionality
    async function sendMessage() {
      const originalMessage = fasongInput.value.trim()

      if (!originalMessage) {
        appendToLimitedLog(msgLogs, '⚠️ 消息内容不能为空', maxLogLines)
        return
      }

      // Apply text replacements
      const processedMessage = applyReplacements(originalMessage)
      const wasReplaced = originalMessage !== processedMessage

      // Clear input immediately after getting the message
      fasongInput.value = ''

      try {
        // Use cached room ID, or fetch it if not available yet
        if (cachedRoomId === null) {
          cachedRoomId = await getRoomId()
        }
        const roomId = cachedRoomId
        const csrfToken = getCsrfToken()

        if (!csrfToken) {
          appendToLimitedLog(msgLogs, '❌ 未找到登录信息，请先登录 Bilibili', maxLogLines)
          return
        }

        const result = await sendDanmaku(processedMessage, roomId, csrfToken)

        if (result.success) {
          const displayMsg = wasReplaced ? `${originalMessage} → ${processedMessage}` : processedMessage
          appendToLimitedLog(msgLogs, `✅ 手动: ${displayMsg}`, maxLogLines)
        } else {
          let errorMsg = result.error || '未知错误'

          // Handle specific error codes
          if (result.error) {
            if (result.error.includes('f')) {
              errorMsg = 'f - 包含全局屏蔽词'
            } else if (result.error.includes('k')) {
              errorMsg = 'k - 包含房间屏蔽词'
            }
          }

          const displayMsg = wasReplaced ? `${originalMessage} → ${processedMessage}` : processedMessage
          appendToLimitedLog(msgLogs, `❌ 手动: ${displayMsg}，原因：${errorMsg}`, maxLogLines)
        }
      } catch (error) {
        appendToLimitedLog(msgLogs, `🔴 发送出错：${error.message}`, maxLogLines)
      }
    }

    // Allow Enter to send message
    fasongInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    })

    // Initialize replacement rules display
    updateReplacementRulesDisplay()

    // ===== Remote Keywords Sync =====

    const REMOTE_KEYWORDS_URL =
      'https://raw.githubusercontent.com/laplace-live/public/refs/heads/master/artifacts/livesrtream-keywords.json'
    const SYNC_INTERVAL = 15 * 60 * 1000 // 15 minutes in milliseconds

    /** @type {HTMLButtonElement} */
    const syncRemoteBtn = document.getElementById('syncRemoteBtn')
    /** @type {HTMLSpanElement} */
    const remoteKeywordsStatus = document.getElementById('remoteKeywordsStatus')
    /** @type {HTMLDivElement} */
    const remoteKeywordsInfo = document.getElementById('remoteKeywordsInfo')

    /**
     * Fetches remote keywords from GitHub
     * @returns {Promise<{global: {keywords: Object}, rooms: Array}>}
     */
    async function fetchRemoteKeywords() {
      const response = await fetch(REMOTE_KEYWORDS_URL)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      return await response.json()
    }

    /**
     * Syncs remote keywords and stores them locally
     * @returns {Promise<void>}
     */
    async function syncRemoteKeywords() {
      try {
        syncRemoteBtn.disabled = true
        syncRemoteBtn.textContent = '同步中…'
        remoteKeywordsStatus.textContent = '正在同步…'
        remoteKeywordsStatus.style.color = '#666'

        const data = await fetchRemoteKeywords()

        // Store the fetched data
        GM_setValue('remoteKeywords', data)
        GM_setValue('remoteKeywordsLastSync', Date.now())
        buildReplacementMap() // Rebuild map when remote keywords change

        // Update status
        updateRemoteKeywordsStatus()

        appendToLimitedLog(msgLogs, '✅ 云端替换规则同步成功', maxLogLines)
      } catch (error) {
        remoteKeywordsStatus.textContent = `同步失败: ${error.message}`
        remoteKeywordsStatus.style.color = '#f44'
        appendToLimitedLog(msgLogs, `❌ 云端替换规则同步失败: ${error.message}`, maxLogLines)
      } finally {
        syncRemoteBtn.disabled = false
        syncRemoteBtn.textContent = '同步'
      }
    }

    /**
     * Updates the display of remote keywords status
     * @returns {void}
     */
    function updateRemoteKeywordsStatus() {
      const remoteKeywords = GM_getValue('remoteKeywords', null)
      const lastSync = GM_getValue('remoteKeywordsLastSync', null)

      if (!remoteKeywords || !lastSync) {
        remoteKeywordsStatus.textContent = '未同步'
        remoteKeywordsStatus.style.color = '#666'
        remoteKeywordsInfo.textContent = ''
        return
      }

      // Get current room ID
      const currentRoomId = cachedRoomId

      // Count keywords
      const globalCount = Object.keys(remoteKeywords.global?.keywords || {}).length
      let roomCount = 0

      if (currentRoomId) {
        const roomData = remoteKeywords.rooms?.find(r => r.room === currentRoomId)
        roomCount = Object.keys(roomData?.keywords || {}).length
      }

      const totalApplied = globalCount + roomCount

      // Format last sync time
      const syncDate = new Date(lastSync)
      const timeStr = syncDate.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })

      remoteKeywordsStatus.textContent = `最后同步: ${timeStr}`
      remoteKeywordsStatus.style.color = '#36a185'
      remoteKeywordsInfo.textContent = `当前房间共 ${totalApplied} 条规则（全局 ${globalCount} + 当前房间 ${roomCount}）`
    }

    // Manual sync button
    syncRemoteBtn.addEventListener('click', () => {
      syncRemoteKeywords()
    })

    // Set the callback for when room ID is ready
    onRoomIdReadyCallback = updateRemoteKeywordsStatus

    // Auto-sync on load
    ;(async () => {
      const lastSync = GM_getValue('remoteKeywordsLastSync', null)
      const now = Date.now()

      // Sync if never synced or last sync was more than 30 minutes ago
      if (!lastSync || now - lastSync > SYNC_INTERVAL) {
        await syncRemoteKeywords()
      } else {
        updateRemoteKeywordsStatus()
      }
    })()

    // Auto-sync every 30 minutes
    setInterval(async () => {
      await syncRemoteKeywords()
    }, SYNC_INTERVAL)

    loop()
    clearInterval(check)
  }, 100)
})()

/**
 * Builds the replacement map from remote and local rules
 * Priority: remote global < remote room-specific < local rules
 * @returns {void}
 */
function buildReplacementMap() {
  const map = new Map()

  // Add remote keywords
  const remoteKeywords = GM_getValue('remoteKeywords', null)
  if (remoteKeywords) {
    // Add global keywords first
    const globalKeywords = remoteKeywords.global?.keywords || {}
    for (const [from, to] of Object.entries(globalKeywords)) {
      if (from) {
        map.set(from, to)
      }
    }

    // Add room-specific keywords (override global if same key)
    if (cachedRoomId) {
      const roomData = remoteKeywords.rooms?.find(r => r.room === cachedRoomId)
      const roomKeywords = roomData?.keywords || {}
      for (const [from, to] of Object.entries(roomKeywords)) {
        if (from) {
          map.set(from, to)
        }
      }
    }
  }

  // Add local rules (override remote if same key)
  const localRules = GM_getValue('replacementRules', [])
  for (const rule of localRules) {
    if (rule.from) {
      map.set(rule.from, rule.to)
    }
  }

  replacementMap = map
}

/**
 * Applies all replacement rules to the given text
 * Uses cached replacement map for efficiency
 * @param {string} text - The text to apply replacements to
 * @returns {string} The text with all replacements applied
 */
function applyReplacements(text) {
  // Build map on first use
  if (replacementMap === null) {
    buildReplacementMap()
  }

  let result = text
  for (const [from, to] of replacementMap.entries()) {
    result = result.split(from).join(to)
  }

  return result
}

/**
 * Gets the CSRF token from browser cookies
 * @returns {string|undefined} The CSRF token (bili_jct), or undefined if not found
 */
function getCsrfToken() {
  return document.cookie
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('bili_jct='))
    ?.split('bili_jct=')[1]
}

/**
 * Gets the room ID for a Bilibili live room
 * @param {string} [url] - The room URL (defaults to current page URL)
 * @returns {Promise<number>} The room ID
 */
async function getRoomId(url = window.location.href) {
  const shortUid = extractRoomNumber(url)

  const room = await fetch(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${shortUid}`, {
    method: 'GET',
    credentials: 'include',
  })

  /** @type {{data: {room_id: number}}} */
  const roomData = await room.json()
  return roomData.data.room_id
}

/**
 * Sends a single danmaku message to Bilibili live room
 * @param {string} message - The message text to send
 * @param {number} roomId - The room ID to send the message to
 * @param {string} csrfToken - The CSRF token for authentication
 * @returns {Promise<{success: boolean, message: string, error?: string}>} Result of the send operation
 */
async function sendDanmaku(message, roomId, csrfToken) {
  const form = new FormData()
  form.append('bubble', '2')
  form.append('msg', message)
  form.append('color', '16777215')
  form.append('mode', '1')
  form.append('room_type', '0')
  form.append('jumpfrom', '0')
  form.append('reply_mid', '0')
  form.append('reply_attr', '0')
  form.append('replay_dmid', '')
  form.append('statistics', '{"appId":100,"platform":5}')
  form.append('fontsize', '25')
  form.append('rnd', String(Math.floor(Date.now() / 1000)))
  form.append('roomid', String(roomId))
  form.append('csrf', csrfToken)
  form.append('csrf_token', csrfToken)

  try {
    const resp = await fetch('https://api.live.bilibili.com/msg/send', {
      method: 'POST',
      credentials: 'include',
      body: form,
    })

    /** @type {{message?: string, code?: number}} */
    const json = await resp.json()

    if (json.message) {
      return {
        success: false,
        message: message,
        error: json.message,
      }
    }

    return {
      success: true,
      message: message,
    }
  } catch (error) {
    return {
      success: false,
      message: message,
      error: error.message,
    }
  }
}

/**
 * Main loop function that handles sending messages to Bilibili live chat
 * Continuously checks if sendMsg is true and sends queued messages with configured intervals
 * @returns {Promise<void>}
 */
async function loop() {
  let count = 0
  /** @type {HTMLTextAreaElement} */
  const msgLogs = document.getElementById('msgLogs')
  /** @type {number} */
  const maxLogLines = GM_getValue('maxLogLines')

  // Fetch and cache room ID on first call
  if (cachedRoomId === null) {
    cachedRoomId = await getRoomId()
    buildReplacementMap() // Rebuild map with room-specific keywords
    // Update remote keywords status now that we have the room ID
    if (onRoomIdReadyCallback) {
      onRoomIdReadyCallback()
    }
  }
  const roomId = cachedRoomId
  const csrfToken = getCsrfToken()

  while (true) {
    if (sendMsg) {
      const currentTemplate = MsgTemplates[activeTemplateIndex] || ''
      if (!currentTemplate.trim()) {
        appendToLimitedLog(msgLogs, '⚠️ 当前模板为空，已自动停止运行', maxLogLines)
        sendMsg = false
        const sendBtn = document.getElementById('sendBtn')
        const toggleBtn = document.getElementById('toggleBtn')
        sendBtn.textContent = '开启独轮车'
        toggleBtn.style.background = 'rgb(166 166 166)'
        continue
      }

      /** @type {number} */
      const msgSendInterval = GM_getValue('msgSendInterval')
      /** @type {boolean} */
      const enableRandomColor = GM_getValue('randomColor')
      /** @type {boolean} */
      const enableRandomInterval = GM_getValue('randomInterval')
      /** @type {boolean} */
      const enableRandomChar = GM_getValue('randomChar')
      const Msg = processMessages(currentTemplate, GM_getValue('maxLength'), enableRandomChar)

      for (const message of Msg) {
        if (sendMsg) {
          // Apply text replacements
          const originalMessage = message
          const processedMessage = applyReplacements(message)
          const wasReplaced = originalMessage !== processedMessage

          if (enableRandomColor) {
            const colorSet = [
              '0xe33fff',
              '0x54eed8',
              '0x58c1de',
              '0x455ff6',
              '0x975ef9',
              '0xc35986',
              '0xff8c21',
              '0x00fffc',
              '0x7eff00',
              '0xffed4f',
              '0xff9800',
            ]
            const randomColor = colorSet[Math.floor(Math.random() * colorSet.length)]

            const configForm = new FormData()
            configForm.append('room_id', String(roomId))
            configForm.append('color', randomColor)
            configForm.append('csrf_token', csrfToken)
            configForm.append('csrf', csrfToken)
            configForm.append('visit_id', '')

            const _updateConfig = await fetch('https://api.live.bilibili.com/xlive/web-room/v1/dM/AjaxSetConfig', {
              method: 'POST',
              credentials: 'include',
              body: configForm,
            })
          }

          const result = await sendDanmaku(processedMessage, roomId, csrfToken)
          const displayMsg = wasReplaced ? `${originalMessage} → ${processedMessage}` : processedMessage
          const logMessage = result.success
            ? `✅ 自动: ${displayMsg}`
            : `❌ 自动: ${displayMsg}，原因：${result.error}。`

          appendToLimitedLog(msgLogs, logMessage, maxLogLines)

          const resolvedRandomInterval = enableRandomInterval ? Math.floor(Math.random() * 500) : 0
          await new Promise(r => setTimeout(r, msgSendInterval * 1000 - resolvedRandomInterval))
        }
      }

      count += 1
      appendToLimitedLog(msgLogs, `🔵第 ${count} 轮发送完成`, maxLogLines)
    } else {
      count = 0
      await new Promise(r => setTimeout(r, 1000))
    }
  }
}
