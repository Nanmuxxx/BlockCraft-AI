// HAND-WRITTEN MOCK RESPONSES ONLY. Kept outside production modules, never executed.
// These examples cannot establish AI originality, functional correctness or isolation.
export const objectSchema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
export const request = (definitionId = 'new-component', requirement = '创造一个新的交互组件') => ({ contractVersion: 1, requestId: 'request-1', definitionId, requirement })
export function response(definitionId = 'new-component') {
  return {
    contractVersion: 1,
    manifest: {
      protocolVersion: 1, definitionId, name: 'Mock 源码样本', sdkVersion: '1.0.0', entry: 'src/Component.tsx',
      propsSchema: objectSchema({ title: { type: 'string', maxLength: 80 } }),
      stateSchema: objectSchema({ value: { type: 'number' } }), events: {}, requestedCapabilities: [],
    },
    sources: { 'src/Component.tsx': 'import React from "react"; export default function Component({title}:{title:string}) { return <button>{title}</button> }' },
    dependencies: ['react'],
  }
}
const countdown = response('focus-clock')
countdown.manifest.name = 'Mock 番茄钟'
countdown.manifest.propsSchema = objectSchema({ durationSeconds: { type: 'integer', minimum: 1, maximum: 86400 } })
countdown.manifest.stateSchema = objectSchema({ remaining: { type: 'integer', minimum: 0 }, running: { type: 'boolean' } })
countdown.sources['src/Component.tsx'] = `import React, {useEffect,useState} from 'react';
export default function FocusClock({durationSeconds}:{durationSeconds:number}) {
 const [remaining,setRemaining]=useState(durationSeconds),[running,setRunning]=useState(false);
 useEffect(()=>{if(!running)return;const id=setInterval(()=>setRemaining(n=>Math.max(0,n-1)),1000);return()=>clearInterval(id)},[running]);
 useEffect(()=>{if(remaining===0)setRunning(false)},[remaining]);
 return <section><output>{remaining}</output><button onClick={()=>setRunning(true)}>开始或继续</button><button onClick={()=>setRunning(false)}>暂停</button></section>
}`
const spinner = response('prize-wheel')
spinner.manifest.name = 'Mock 抽奖转盘'
spinner.manifest.propsSchema = objectSchema({ prizes: { type: 'string', maxLength: 500 } })
spinner.manifest.stateSchema = objectSchema({ selected: { type: 'string', maxLength: 500 } })
spinner.sources['src/Component.tsx'] = `import React,{useState} from 'react';
export default function PrizeWheel({prizes}:{prizes:string}) {
 const entries=prizes.split(',').filter(Boolean),[selected,setSelected]=useState('');
 return <section><output>{selected}</output><button disabled={!entries.length} onClick={()=>setSelected(entries[Math.floor(Math.random()*entries.length)])}>抽奖</button></section>
}`
const bmi = response('body-index')
bmi.manifest.name = 'Mock BMI 计算器'
bmi.manifest.propsSchema = objectSchema({ heightCm: { type: 'number', minimum: 30, maximum: 300 }, weightKg: { type: 'number', minimum: 1, maximum: 500 } })
bmi.manifest.stateSchema = objectSchema({ submitted: { type: 'boolean' } })
bmi.sources['src/Component.tsx'] = `import React,{useState} from 'react';
export default function BodyIndex({heightCm,weightKg}:{heightCm:number,weightKg:number}) {
 const [submitted,setSubmitted]=useState(false);
 return <section><button onClick={()=>setSubmitted(true)}>计算</button><output>{submitted?(weightKg/((heightCm/100)**2)).toFixed(1):''}</output></section>
}`
export const scenarios = [
  { request: request('focus-clock', '请创造一个支持开始、暂停、继续的番茄钟，时长可配置'), output: countdown },
  { request: request('prize-wheel', '我需要一个从逗号分隔奖项中随机抽奖的转盘组件'), output: spinner },
  { request: request('body-index', '做一个用身高体重计算 BMI 的交互组件'), output: bmi },
]
