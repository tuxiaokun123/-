// index.ts

import mqtt from '../index/mqtt.min.js'
// 存 MQTT 客户端的地方（整个页面共用，放在文件最上面）
//mqttclient
let mqttClient: any = null

// 备选服务器列表：从上往下挨个试，连不上自动换下一个
// （公共服务器免费但不稳定，多备几条线路，谁能通用谁）
const BROKER_LIST = [
  'wxs://broker.hivemq.com:8884/mqtt',
  'wxs://broker.emqx.io:8084/mqtt',
  'wxs://mqtt.eclipseprojects.io:443/mqtt',
]

// 要订阅的主题（以后想换主题，只改这一行）
// 注意：小程序和设备端必须用同一个主题，改这里的话设备固件也要同步改
// 公共服务器人很多，主题名要起得独特一点，避免和别人撞车收到别人的数据
const TOPIC = 'vc6_collector_001'

// 连接尝试的编号：只有"最新一次尝试"才有资格改页面状态，
// 防止上一次失败连接的迟到事件跑出来捣乱
let connectAttempt = 0

Component({
  data: {
    // 记事本：6 个通道，type 是"电压/电流"，value 是显示的数字，unit 是单位
    items: [
      { name: '通道1', type: '--', value: '0.00', unit: '' },
      { name: '通道2', type: '--', value: '0.00', unit: '' },
      { name: '通道3', type: '--', value: '0.00', unit: '' },
      { name: '通道4', type: '--', value: '0.00', unit: '' },
      { name: '通道5', type: '--', value: '0.00', unit: '' },
      { name: '通道6', type: '--', value: '0.00', unit: '' },
    ],
    // 连接状态：一开始显示"未连接"
    statusText: '未连接',
    connected: false,   // 记着：连没连上
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
          this.setData({ connected: false, statusText: '连接断开了' })
        } else {
          this.tryConnect()
        }
      })
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

    // 把收到的消息翻译成 6 个通道要显示的数字
    handleMessage(msg: string) {
      // 去掉头尾的空格和换行（设备发完数据常带个回车）
      msg = msg.trim()

      // 消息长这样："11:22050"
      //   第1个字符：1=电压，0=电流
      //   第2个字符：通道号（1~6）
      //   冒号后面：整数，除以100才是真实数值
      const parts = msg.split(':')
      if (parts.length !== 2) return          // 格式不对，就不理它
      if (parts[0].length < 2) return         // 前面至少要有2个字符

      const typeCode = parts[0].charAt(0)         // 第1个字符
      const channel = Number(parts[0].charAt(1))  // 第2个字符（通道号）
      const raw = Number(parts[1])                // 冒号后面的整数

      // 通道号必须在 1~6 之间、数字必须有效，否则不理它
      if (channel < 1 || channel > 6 || isNaN(raw)) return

      const isVoltage = typeCode === '1'
      const typeName = isVoltage ? '电压' : '电流'
      const unit = isVoltage ? 'V' : 'A'
      const value = (raw / 100).toFixed(2)    // 除以100，保留2位小数

      // 只改对应那个通道（记事本里的第 channel 个兄弟）
      const key = 'items[' + (channel - 1) + ']'
      this.setData({
        [key + '.value']: value,
        [key + '.type']: typeName,
        [key + '.unit']: unit,
      })
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