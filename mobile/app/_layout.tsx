import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, PTSans_400Regular, PTSans_700Bold } from '@expo-google-fonts/pt-sans';
import { AuthProvider } from '../src/contexts/AuthContext';
import { ChildProvider } from '../src/contexts/ChildContext';
import { ApiClientProvider } from '../src/contexts/ApiClientContext';
import { colors } from '../src/theme';

// Apply PT Sans to every <Text> that doesn't set its own family. Bold styles
// additionally set fontFamily: 'PTSans_700Bold' so the bold face is used.
const TextAny = Text as unknown as { defaultProps?: { style?: unknown }; render?: unknown };
const baseRender = TextAny.render as ((...args: unknown[]) => { props: { style?: unknown } }) | undefined;
if (baseRender && !(TextAny as { __brandPatched?: boolean }).__brandPatched) {
  (TextAny as { __brandPatched?: boolean }).__brandPatched = true;
  TextAny.render = function patched(this: unknown, ...args: unknown[]) {
    const el = baseRender.apply(this, args);
    return {
      ...el,
      props: { ...el.props, style: [{ fontFamily: 'PTSans_400Regular' }, el.props.style] },
    };
  } as unknown as typeof TextAny.render;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ PTSans_400Regular, PTSans_700Bold });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ApiClientProvider>
          <ChildProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
              }}
            />
          </ChildProvider>
        </ApiClientProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
