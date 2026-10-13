// index.ts

import mqtt from '../index/mqtt.min.js'
// 存 MQTT 客户端的地方（整个页面共用，放在文件最上面）
//mqttclient
let mqttClient: any = null

// 备选服务器列表：从上往下挨个试，连不上自动换下一个
// 目前只用 EMQX 一台；想加备用线路，往数组里添一行就行，例如：
//   'wxs://broker.hivemq.com:8884/mqtt',
const BROKER_LIST = [
  'wxs://broker.emqx.io:8084/mqtt',
]

// 要订阅的主题（以后想换主题，只改这一行）
// 注意：小程序和设备端必须用同一个主题，改这里的话设备固件也要同步改
// 公共服务器人很多，主题名要起得独特一点，避免和别人撞车收到别人的数据
const TOPIC = 'vc6_collector_001'

// 连接尝试的编号：只有"最新一次尝试"才有资格改页面状态，
// 防止上一次失败连接的迟到事件跑出来捣乱
let connectAttempt = 0

// ===== 设备离线检测 =====
// 真实单片机可能在现场断电、断网、死机……页面得能发现"数据不来了"
let lastFrameAt = 0        // 最后一次收到数据帧的时间戳
let staleTimer: any = null // 离线检测定时器

// 超过这么久没收到数据帧，就认为设备掉线（毫秒）
const STALE_MS = 10000

Component({
  data: {
    // 记事本：6 个通道，v=电压读数，i=电流读数；没数据时显示 "--"
    items: [
      { name: '通道1', v: '--', i: '--' },
      { name: '通道2', v: '--', i: '--' },
      { name: '通道3', v: '--', i: '--' },
      { name: '通道4', v: '--', i: '--' },
      { name: '通道5', v: '--', i: '--' },
      { name: '通道6', v: '--', i: '--' },
    ],
    // 连接状态：一开始显示"未连接"
    statusText: '未连接',
    connected: false,   // 记着：连没连上
    hasData: false,     // 记着：收到过数据帧没有
    stale: false,       // 记着：设备是不是疑似掉线（数据超时）
    lastUpdate: '',     // 最后一次收到数据的时间（显示在状态卡片右上角）
  },

  lifetimes: {
    // 页面销毁时把离线检测定时器关掉，别在后台留垃圾
    detached() {
      if (staleTimer) clearInterval(staleTimer)
    },
  },

  methods: {
    // 门铃响（点击"点击连接"按钮）时要做的事
    onConnect() {
      // 已经连上了，就别再连一次
      if (this.data.connected) {
        this.setData({ statusText: '已经连上了' })
        return
      }
      connectAttempt = 0        // 从头开始试线路
      this.tryConnect()
    },

    // 挨个试服务器列表里的线路，哪条通用哪条
    tryConnect() {
      // 全试完了还没连上：如实汇报，不再硬试
      if (connectAttempt >= BROKER_LIST.length) {
        this.setData({ statusText: '连接失败：所有线路都试过了，请检查网络' })
        return
      }

      const attempt = ++connectAttempt                 // 本次尝试的编号
      const url = BROKER_LIST[attempt - 1]             // 这次要试的服务器
      const isStale = () => attempt !== connectAttempt  // 是不是"过期的尝试"

      this.setData({
        statusText: '正在连接……（线路 ' + attempt + '/' + BROKER_LIST.length + '）',
      })
      console.log('尝试连接服务器：', url)

      // 给自己起个不跟别人撞车的名字
      const clientId = 'wx_' + Date.now() + '_' + Math.floor(Math.random() * 10000)

      // 开始连接（微信小程序里 ws 要写成 wxs）
      const client = mqtt.connect(url, {
        clientId: clientId,
        clean: true,
        connectTimeout: 5000,
      })

      // 看门狗：万一底层卡死（连不上又不说一声），8 秒后强制换下一条线路
      const watchdog = setTimeout(() => {
        if (isStale()) return
        console.log('连接超时，换下一条线路：', url)
        client.end(true)
        this.tryConnect()
      }, 8000)

      // 连接成功的庆祝仪式
      client.on('connect', () => {
        clearTimeout(watchdog)
        if (isStale()) return
        mqttClient = client   // 记下这个能用的连接，收消息/发指令都靠它
        this.setData({
          connected: true,
          statusText: '连接成功！（线路 ' + attempt + '）',
        })
        this.startStaleWatch()   // 连上后开始盯着"数据还来不来"

        // 连接成功后，订阅主题，等着收设备发来的数据
        client.subscribe(TOPIC, (err: any) => {
          if (err) {
            console.log('订阅失败', err)
            this.setData({ statusText: '连接成功，但订阅失败' })
          }
        })
      })

      // 收到消息的仪式：设备一发数据，这里就被叫醒
      client.on('message', (_topic: string, payload: any) => {
        if (isStale()) return
        // 先把收到的"任何样子的数据"翻译成一串字符，再交给翻译官
        this.handleMessage(this.bytesToString(payload))
      })

      // 连接出错的安慰仪式：还没连上就出错 → 自动换下一条线路
      client.on('error', (err: any) => {
        const msg = err && err.message ? err.message : '网络出问题了'
        console.log('MQTT 出错：', url, msg)
        clearTimeout(watchdog)
        if (isStale()) return
        if (this.data.connected) {
          // 连上之后出错：直接提示，不换线路（mqtt.js 会自动重连）
          this.setData({ statusText: '连接出错：' + msg })
          return
        }
        client.end(true)      // 关掉这次失败的连接
        this.tryConnect()     // 换下一条线路
      })

      // 连接断开的提示：还没连上就断开 → 也自动换下一条线路
      client.on('close', () => {
        clearTimeout(watchdog)
        if (isStale()) return
        if (this.data.connected) {
          // 真正的连接断开了：停掉离线检测，如实汇报
          if (staleTimer) clearInterval(staleTimer)
          this.setData({ connected: false, stale: false, statusText: '连接断开了' })
        } else {
          this.tryConnect()
        }
      })
    },

    // 离线检测：每 2 秒看一眼"上一帧数据是不是来太久了"
    startStaleWatch() {
      if (staleTimer) clearInterval(staleTimer)
      staleTimer = setInterval(() => {
        // 还没连上、或者一帧数据都没收过：先不判断
        if (!this.data.connected || !this.data.hasData) return
        const stale = Date.now() - lastFrameAt > STALE_MS
        // 状态变了才改页面，别每 2 秒刷一遍
        if (stale !== this.data.stale) {
          this.setData({
            stale: stale,
            statusText: stale ? '数据超时：设备可能已离线' : '连接成功！',
          })
        }
      }, 2000)
    },

    // 把收到的数据变成一串字符（设备可能用各种方式发来，这里都接得住）
    bytesToString(payload: any): string {
      // 已经是字符串，直接用
      if (typeof payload === 'string') return payload

      // 是二进制块？先拆成一个个字节
      if (payload instanceof ArrayBuffer) {
        payload = new Uint8Array(payload)
      }

      // 是字节数组：把每个字节翻译成对应的字符，拼成一句话
      let text = ''
      for (let i = 0; i < payload.length; i++) {
        text += String.fromCharCode(payload[i])
      }
      return text
    },

    // 把收到的消息翻译成 6 个通道的电压+电流
    // 数据格式（JSON 一帧全量，每通道带 V/I 双值）：
    //   {"dev":"vc6_001","ch":[{"n":1,"v":220.50,"i":0.52},{"n":2,"v":219.80,"i":1.83},...]}
    //     n = 通道号 1~6
    //     v = 电压，单位伏特（直接发小数，不用乘 100）
    //     i = 电流，单位安培（直接发小数）
    //     某一路缺 v 或缺 i，就保留原来的显示不动
    // 控制指令 "1"/"0" 不是 JSON 对象，会被下面的格式校验挡住
    handleMessage(msg: string) {
      // 去掉头尾的空格和换行（设备发完数据常带个回车）
      msg = msg.trim()

      // 先把消息当成 JSON 试着翻译一下，翻不动就说明不是我们的数据，不理它
      let frame: any
      try {
        frame = JSON.parse(msg)
      } catch (e) {
        return
      }
      // 必须是对象、且带 ch 数组才算合法数据帧
      if (!frame || typeof frame !== 'object' || !Array.isArray(frame.ch)) return

      // 抄一份记事本，把这帧里的通道一个个填进去
      const items = this.data.items.slice()
      for (const c of frame.ch) {
        const n = Number(c.n)      // 通道号
        if (n < 1 || n > 6) continue   // 通道号不对就跳过

        const old = items[n - 1]
        const vNum = Number(c.v)
        const iNum = Number(c.i)
        items[n - 1] = {
          name: '通道' + n,
          // 缺数据或数据无效：保留原来的显示，别用 NaN 糊弄人
          v: (c.v === undefined || isNaN(vNum)) ? old.v : vNum.toFixed(2),
          i: (c.i === undefined || isNaN(iNum)) ? old.i : iNum.toFixed(2),
        }
      }

      // 记下几点几分几秒收到的这帧数据，显示在状态卡片右上角
      const now = new Date()
      const pad = (x: number) => (x < 10 ? '0' + x : '' + x)
      const lastUpdate =
        pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds())

      lastFrameAt = Date.now()   // 给离线检测对表：刚收到新数据
      this.setData({ items, lastUpdate, hasData: true })

      // 如果之前判过"设备离线"，现在数据来了，宣布恢复
      if (this.data.stale) {
        this.setData({ stale: false, statusText: '连接成功！数据恢复' })
      }
    },

    // 开灯：向主题发 1
    turnOn() {
      // 还没连上服务器？先提醒用户
      if (!this.data.connected || !mqttClient) {
        this.setData({ statusText: '还没连上，先点"点击连接"' })
        return
      }

      mqttClient.publish(TOPIC, '1')
      this.setData({ statusText: '已发送开灯（1）' })
    },

    // 关灯：向主题发 0
    turnOff() {
      // 还没连上服务器？先提醒用户
      if (!this.data.connected || !mqttClient) {
        this.setData({ statusText: '还没连上，先点"点击连接"' })
        return
      }

      mqttClient.publish(TOPIC, '0')
      this.setData({ statusText: '已发送关灯（0）' })
    },
  },
})
