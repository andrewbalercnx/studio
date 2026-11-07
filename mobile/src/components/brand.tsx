/**
 * Brand primitives: the StoryPic Kids logo mark and the line-icon set.
 * Icons come from Feather (@expo/vector-icons) in one weight, tinted from the
 * theme — see docs/SYSTEM_DESIGN.md "Mobile app branding".
 */
import { Feather } from '@expo/vector-icons';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { colors } from '../theme';

// The generated gradient brand icon doubles as the in-app badge.
const markSource = require('../../assets/icon.png');

export function BrandMark({ size = 40, style }: { size?: number; style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      source={markSource}
      style={[{ width: size, height: size, borderRadius: size * 0.22 }, style]}
      accessibilityLabel="StoryPic Kids"
    />
  );
}

export type IconName =
  | 'home' | 'create' | 'library' | 'stories' | 'read'
  | 'child' | 'talk' | 'settings' | 'back' | 'sound' | 'close' | 'plus';

const FEATHER: Record<IconName, keyof typeof Feather.glyphMap> = {
  home: 'home',
  create: 'edit-3',
  library: 'book',
  stories: 'book-open',
  read: 'play-circle',
  child: 'user',
  talk: 'mic',
  settings: 'settings',
  back: 'chevron-left',
  sound: 'volume-2',
  close: 'x',
  plus: 'plus',
};

export function Icon({
  name,
  size = 22,
  color = colors.primary,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Feather name={FEATHER[name]} size={size} color={color} />;
}
