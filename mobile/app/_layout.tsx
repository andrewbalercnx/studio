import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/contexts/AuthContext';
import { ChildProvider } from '../src/contexts/ChildContext';
import { ApiClientProvider } from '../src/contexts/ApiClientContext';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ApiClientProvider>
          <ChildProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: '#FEF3C7' },
              }}
            />
          </ChildProvider>
        </ApiClientProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
