# StoryPic Kids Mobile App

React Native mobile app built with Expo for Android and iOS.

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm start

# Run on Android
npm run android

# Run on iOS
npm run ios
```

## Project Structure

```
mobile/
├── app/                    # Expo Router pages
│   ├── _layout.tsx        # Root layout with providers
│   ├── index.tsx          # Entry/routing logic
│   ├── login.tsx          # Parent login
│   ├── select-child.tsx   # Child selection
│   ├── home.tsx           # Child dashboard
│   ├── create.tsx         # Generator selection
│   ├── stories.tsx        # Stories list
│   ├── books.tsx          # Storybooks list
│   ├── play/
│   │   └── [sessionId].tsx  # Story creation (wizard)
│   └── story/
│       └── [storyId].tsx    # Story detail/read
├── src/
│   └── contexts/
│       ├── AuthContext.tsx      # Firebase auth
│       ├── ApiClientContext.tsx # API client
│       └── ChildContext.tsx     # Selected child
├── app.json               # Expo config
├── eas.json               # EAS Build config
└── package.json
```

## Building for Android

### Development Build (APK for testing)
```bash
# First time: Log in to Expo
npx eas login

# Build APK
npx eas build --platform android --profile preview
```

### Production Build (App Bundle for Play Store)
```bash
npx eas build --platform android --profile production
```

## Features

- **Story Creation**: Wizard-based story generation
- **Story Reading**: Text + audio narration
- **Storybook Viewing**: Picture book reader
- **Child-locked Experience**: PIN required to switch children

## API Configuration

The app connects to the StoryPic backend at `https://storypic.rcnx.io`.

To change the API URL, edit `src/contexts/ApiClientContext.tsx`:
```typescript
const API_BASE_URL = 'https://your-backend-url.com';
```

## Firebase Configuration

Auth uses Firebase REST API (no native Firebase SDK needed for Expo Go).

Update the API key in `src/contexts/AuthContext.tsx`:
```typescript
const FIREBASE_API_KEY = 'your-firebase-api-key';
```
