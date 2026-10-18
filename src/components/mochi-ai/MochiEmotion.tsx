import { MochiCat } from '../MochiCat'
import type { MochiEmotion } from './MochiTypes'
import './mochi-ai.css'
import './mochi-motion.css'

const labels: Record<MochiEmotion, string> = {
  idle: 'Mochi 正在陪伴',
  thinking: 'Mochi 正在思考',
  curious: 'Mochi 正在观察',
  happy: 'Mochi 很开心',
  celebrating: 'Mochi 在庆祝',
  error: 'Mochi 遇到问题',
}

export interface MochiEmotionProps {
  emotion: MochiEmotion
  className?: string
  label?: string
}

export function MochiEmotion({ emotion, className = '', label }: MochiEmotionProps) {
  return (
    <span className={`mochi-emotion mochi-emotion--${emotion} ${className}`.trim()} data-emotion={emotion} role="img" aria-label={label ?? labels[emotion]}>
      <span className="mochi-emotion__body" aria-hidden="true">
        <MochiCat className="mochi-emotion__image" />
        <span className="mochi-emotion__eyelid mochi-emotion__eyelid--left" />
        <span className="mochi-emotion__eyelid mochi-emotion__eyelid--right" />
      </span>
      <span className="mochi-emotion__cue" aria-hidden="true">{{ idle: '', curious: '?', thinking: '···', happy: '♥', celebrating: '✦', error: '!' }[emotion]}</span>
    </span>
  )
}
