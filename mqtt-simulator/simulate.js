// 六路采集器数据模拟器：循环向所有备选 MQTT 服务器发送 6 个通道的模拟数据
// 用来在没有真实设备时测试小程序看板。
//
// 数据格式（JSON 一帧全量）：一条消息带全部 6 个通道，一次刷新整个看板
//   {"dev":"vc6_001","ch":[{"n":1,"t":"V","val":220.50},{"n":2,"t":"V","val":53.00},...]}
//     n   = 通道号 1~6
//     t   = 类型："V"=电压，"A"=电流
//     val = 真实数值（直接发小数，不用乘 100）
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
  'wss://broker.emqx.io:8084/mqtt',
]
const TOPIC = 'vc6_collector_001'

// 6 个通道：n=通道号，t=类型(V电压/A电流)，base=基准值（发送时 ±2% 波动）
const channels = [
  { n: 1, t: 'V', base: 220.0 },   // 通道1 电压 基准 220.00 V
  { n: 2, t: 'V', base: 53.0 },    // 通道2 电压 基准 53.00 V
  { n: 3, t: 'V', base: 121.0 },   // 通道3 电压 基准 121.00 V
  { n: 4, t: 'A', base: 15.2 },    // 通道4 电流 基准 15.20 A
  { n: 5, t: 'A', base: 2.3 },     // 通道5 电流 基准 2.30 A
  { n: 6, t: 'A', base: 8.75 },    // 通道6 电流 基准 8.75 A
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
      const frame = {
        dev: 'vc6_collector_001',
        ch: channels.map(c => {
          const val = +(c.base * (0.98 + Math.random() * 0.04)).toFixed(2)  // ±2% 波动
          return { n: c.n, t: c.t, val }
        }),
      }
      const msg = JSON.stringify(frame)
      client.publish(TOPIC, msg, { retain: true }) // retain：新连上的订阅者立刻能收到
      console.log(`[${shortName(url)}] 第${round}帧 ${msg}`)
    }
    sendRound()
    timer = setInterval(sendRound, 2000)
  })

  client.on('error', (e) => {
    console.log(`[${shortName(url)}] 出错：`, e.message)
  })

  client.on('close', () => {
    console.log(`[${shortName(url)}] 连接断开，自动重连中……`)
  })
}

console.log('模拟器已启动，按 Ctrl+C 停止')
