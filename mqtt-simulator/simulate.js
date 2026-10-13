// 六路采集器数据模拟器：循环向所有备选 MQTT 服务器发送 6 个通道的模拟数据
// 用来在没有真实设备时测试小程序看板。
//
// 用法（在自己电脑上）：
//   1. 安装 Node.js：https://nodejs.org
//   2. 在本文件夹打开命令行，执行：npm install mqtt
//   3. 运行：node simulate.js
//   4. 小程序里点"点击连接"，即可看到 6 个通道的数字每 2 秒跳动一次
//   5. 按 Ctrl+C 停止
//
// 注意：
//   - TOPIC 必须和小程序 pages/index/index.ts 里的 TOPIC 完全一致
//   - 服务器列表要和小程序里的 BROKER_LIST 保持一致（小程序连上哪条线，
//     就得保证那条线上有人发数据）
const mqtt = require('mqtt')

// 和小程序 index.ts 里的 BROKER_LIST 对应（小程序用 wxs://，普通程序用 wss://）
const BROKERS = [
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://mqtt.eclipseprojects.io:443/mqtt',
]
const TOPIC = 'vc6_collector_001'

// 6 个通道的基准值，发送时在 ±2% 内随机波动
// 消息格式："类型+通道号:数值x100"
//   第 1 位：1=电压，0=电流
//   第 2 位：通道号 1~6
//   冒号后：真实值 x 100（例 22000 -> 220.00V）
const channels = [
  { ch: 1, type: '1', base: 22000 },  // 通道1 电压 基准 220.00 V
  { ch: 2, type: '1', base: 5300 },   // 通道2 电压 基准 53.00 V
  { ch: 3, type: '1', base: 12100 },  // 通道3 电压 基准 121.00 V
  { ch: 4, type: '0', base: 1520 },   // 通道4 电流 基准 15.20 A
  { ch: 5, type: '0', base: 230 },    // 通道5 电流 基准 2.30 A
  { ch: 6, type: '0', base: 875 },    // 通道6 电流 基准 8.75 A
]

const shortName = (u) => u.split('//')[1].split(':')[0]

for (const url of BROKERS) {
  const client = mqtt.connect(url, {
    clientId: 'sim_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
    clean: true,
    connectTimeout: 8000,
    keepalive: 30,
  })
  let timer = null
  let round = 0

  client.on('connect', () => {
    console.log(`[${shortName(url)}] 已连接，开始每 2 秒发一轮数据`)
    if (timer) return   // 断线重连时不重复开定时器
    const sendRound = () => {
      round++
      for (const c of channels) {
        const jitter = Math.round(c.base * (0.98 + Math.random() * 0.04))
        const msg = `${c.type}${c.ch}:${jitter}`
        client.publish(TOPIC, msg, { retain: true }) // retain：新连上的订阅者立刻能收到
      }
      console.log(`[${shortName(url)}] 第${round}轮已发`)
    }
    sendRound()
    timer = setInterval(sendRound, 2000)
  })

  client.on('error', (e) => {
    console.log(`[${shortName(url)}] 出错：`, e.message, '（10秒后自动重试）')
  })

  client.on('close', () => {
    console.log(`[${shortName(url)}] 连接断开，自动重连中……`)
  })
}

console.log('模拟器已启动，按 Ctrl+C 停止')
