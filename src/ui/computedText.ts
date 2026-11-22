// Explanations for values the app computes, quoting the same constants the
// computations use.
import { locale, t, units } from '../state/store';
import { CLIMB_HYSTERESIS, ELE_SMOOTH_S, GRADE_HALF_WINDOW, MOVING_KMH } from '../derive/derive';
import { fmtEle, fmtNum, fmtSpeed } from '../format';
import { RUNNING_KMH } from '../color/scale';
import { unitOf } from './labels';

const eleText = (m: number) => `${fmtEle(m, units.value, locale.value)} ${unitOf('ele')}`;

export const explain = {
  distance: () => t('computed.distance'),
  duration: () => t('computed.duration'),
  moving: () => t('computed.moving', { speed: `${fmtSpeed(MOVING_KMH, units.value, locale.value)} ${unitOf('speed')}` }),
  avgSpeed: () => t('computed.avgSpeed'),
  maxSpeed: (derived: boolean) => t('computed.maxSpeed') + (derived ? ' ' + t('computed.speedDerived') : ''),
  speedDerived: () => t('computed.speedDerived'),
  grade: () => t('computed.grade', { distance: eleText(GRADE_HALF_WINDOW * 2), s: ELE_SMOOTH_S * 2 }),
  climb: () => t('computed.climb', { s: ELE_SMOOTH_S * 2, height: eleText(CLIMB_HYSTERESIS) }),
  eleRange: () => t('computed.eleRange'),
  interval: () => t('computed.interval'),
  medianHdop: () => t('computed.medianHdop'),
  medianSats: () => t('computed.medianSats'),
  corrected: () => t('computed.corrected'),
  ellipsoid: () => t('computed.ellipsoid'),
  hdopRelative: () => t('computed.hdopRelative'),
  shares: () => t('computed.shares'),
  steps: () => t('computed.steps'),
  stepsLog: (s: { edges: number[] }) => t('computed.stepsLog', { ratio: fmtNum(s.edges[1] / s.edges[0], locale.value, 1, 1), running: `${fmtSpeed(RUNNING_KMH, units.value, locale.value, 0)} ${unitOf('speed')}` }),
};
