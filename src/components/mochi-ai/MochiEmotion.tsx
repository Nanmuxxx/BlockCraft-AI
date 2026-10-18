import { Sparkles } from 'lucide-react'
import { MochiCat } from '../MochiCat'
import type { MochiEmotion } from './MochiTypes'
import './mochi-ai.css'

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
      <MochiCat className="mochi-emotion__image" />
      <Sparkles className="mochi-emotion__spark" size={14} aria-hidden="true" />
    </span>
  )
}
