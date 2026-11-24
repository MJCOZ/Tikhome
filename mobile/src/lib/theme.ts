import { I18nManager, TextStyle, ViewStyle } from 'react-native';

export const C = {
  bg: '#0E1411',
  panel: '#17201B',
  panel2: '#27322C',
  ink: '#F4F1EA',
  mute: '#C9D3CD',
  mute2: '#8FA39A',
  acc: '#1FB58F',
  accInk: '#06231B',
  accSoft: '#7DE8C9',
  gold: '#F2C46D',
  red: '#E5534B',
  border: '#222D27',
};

// التطبيق عربي: نرتب العناصر من اليمين لليسار سواء كان الجهاز بوضع RTL أم لا
const isRTL = I18nManager.isRTL;
export const row: ViewStyle = { flexDirection: isRTL ? 'row' : 'row-reverse' };
export const rtlText: TextStyle = { textAlign: isRTL ? 'left' : 'right', writingDirection: 'rtl' };
export const start: ViewStyle = { alignItems: isRTL ? 'flex-start' : 'flex-end' };
