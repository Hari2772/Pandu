import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'package:flutter_windowmanager/flutter_windowmanager.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';

// Core imports
import 'core/services/api_service.dart';
import 'core/services/auth_service.dart';
import 'core/services/location_service.dart';
import 'core/services/socket_service.dart';
import 'core/services/local_storage_service.dart';
import 'core/services/streak_service.dart';
import 'core/services/ad_service.dart';
import 'core/services/notification_service.dart';
import 'core/services/security_service.dart';

// Providers
import 'core/providers/auth_providers.dart';
import 'core/providers/user_providers.dart';
import 'core/providers/chat_providers.dart';
import 'core/providers/streak_providers.dart';

// Screens
import 'presentation/screens/auth_screen.dart';
import 'presentation/screens/home_screen.dart';
import 'presentation/screens/nearby_screen.dart';
import 'presentation/screens/chat_screen.dart';
import 'presentation/screens/friends_screen.dart';
import 'presentation/screens/stories_screen.dart';
import 'presentation/screens/live_broadcast_screen.dart';
import 'presentation/screens/streak_dashboard_screen.dart';
import 'presentation/screens/settings_screen.dart';

// Utils
import 'core/utils/constants.dart';
import 'core/utils/theme.dart';
import 'core/utils/routes.dart';
import 'core/utils/logger.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize Firebase
  await Firebase.initializeApp();
  
  // Configure Crashlytics
  await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(true);
  FlutterError.onError = FirebaseCrashlytics.instance.recordFlutterFatalError;

  // Initialize Hive
  await Hive.initFlutter();
  await LocalStorageService.initialize();

  // Initialize AdMob
  await MobileAds.instance.initialize();

  // Enable security features
  await SecurityService.enableSecurityFeatures();

  // Request permissions
  await _requestPermissions();

  // Initialize services
  await _initializeServices();

  runApp(
    ProviderScope(
      child: NearChatApp(),
    ),
  );
}

class NearChatApp extends ConsumerStatefulWidget {
  @override
  ConsumerState<NearChatApp> createState() => _NearChatAppState();
}

class _NearChatAppState extends ConsumerState<NearChatApp> with WidgetsBindingObserver {
  late FirebaseAnalytics analytics;
  late FirebaseAnalyticsObserver observer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    
    // Initialize Firebase Analytics
    analytics = FirebaseAnalytics.instance;
    observer = FirebaseAnalyticsObserver(analytics: analytics);
    
    // Set up app lifecycle monitoring
    _setupAppLifecycle();
    
    // Initialize app data
    _initializeAppData();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    
    switch (state) {
      case AppLifecycleState.resumed:
        _onAppResumed();
        break;
      case AppLifecycleState.inactive:
        _onAppInactive();
        break;
      case AppLifecycleState.paused:
        _onAppPaused();
        break;
      case AppLifecycleState.detached:
        _onAppDetached();
        break;
      case AppLifecycleState.hidden:
        _onAppHidden();
        break;
    }
  }

  void _onAppResumed() {
    Logger.info('App resumed');
    // Reconnect socket
    ref.read(socketServiceProvider).reconnect();
    // Update user online status
    ref.read(authServiceProvider).updateOnlineStatus(true);
    // Refresh location
    ref.read(locationServiceProvider).refreshLocation();
  }

  void _onAppInactive() {
    Logger.info('App inactive');
  }

  void _onAppPaused() {
    Logger.info('App paused');
    // Update user online status
    ref.read(authServiceProvider).updateOnlineStatus(false);
  }

  void _onAppDetached() {
    Logger.info('App detached');
    // Clean up resources
    ref.read(socketServiceProvider).disconnect();
  }

  void _onAppHidden() {
    Logger.info('App hidden');
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authStateProvider);
    
    return MaterialApp(
      title: 'NearChat',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: ThemeMode.system,
      navigatorObservers: [observer],
      
      // Routes
      initialRoute: authState.when(
        data: (user) => user != null ? AppRoutes.home : AppRoutes.auth,
        loading: () => AppRoutes.splash,
        error: (_, __) => AppRoutes.auth,
      ),
      
      routes: {
        AppRoutes.splash: (context) => SplashScreen(),
        AppRoutes.auth: (context) => AuthScreen(),
        AppRoutes.home: (context) => HomeScreen(),
        AppRoutes.nearby: (context) => NearbyScreen(),
        AppRoutes.chat: (context) => ChatScreen(),
        AppRoutes.friends: (context) => FriendsScreen(),
        AppRoutes.stories: (context) => StoriesScreen(),
        AppRoutes.liveBroadcast: (context) => LiveBroadcastScreen(),
        AppRoutes.streakDashboard: (context) => StreakDashboardScreen(),
        AppRoutes.settings: (context) => SettingsScreen(),
      },
      
      // Error handling
      builder: (context, child) {
        return MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaleFactor: 1.0),
          child: child!,
        );
      },
    );
  }

  void _setupAppLifecycle() {
    // Monitor app performance
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _monitorPerformance();
    });
  }

  void _initializeAppData() async {
    try {
      // Load user preferences
      await ref.read(localStorageServiceProvider).loadPreferences();
      
      // Initialize notifications
      await ref.read(notificationServiceProvider).initialize();
      
      // Check for app updates
      await _checkForUpdates();
      
      // Initialize analytics
      await _initializeAnalytics();
      
    } catch (e) {
      Logger.error('Error initializing app data: $e');
      FirebaseCrashlytics.instance.recordError(e, StackTrace.current);
    }
  }

  void _monitorPerformance() {
    // Monitor frame rate
    WidgetsBinding.instance.addPersistentFrameCallback((timeStamp) {
      // Performance monitoring logic
    });
  }

  Future<void> _checkForUpdates() async {
    // Check for app updates logic
  }

  Future<void> _initializeAnalytics() async {
    await analytics.setAnalyticsCollectionEnabled(true);
    await analytics.logAppOpen();
  }
}

class SplashScreen extends ConsumerStatefulWidget {
  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen> with TickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    
    _animationController = AnimationController(
      duration: const Duration(seconds: 2),
      vsync: this,
    );
    
    _fadeAnimation = Tween<double>(
      begin: 0.0,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeIn,
    ));
    
    _scaleAnimation = Tween<double>(
      begin: 0.8,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.elasticOut,
    ));
    
    _animationController.forward();
    
    // Auto-navigate after animation
    Future.delayed(Duration(seconds: 3), () {
      _checkAuthAndNavigate();
    });
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  void _checkAuthAndNavigate() {
    final authState = ref.read(authStateProvider);
    
    authState.when(
      data: (user) {
        if (user != null) {
          Navigator.pushReplacementNamed(context, AppRoutes.home);
        } else {
          Navigator.pushReplacementNamed(context, AppRoutes.auth);
        }
      },
      loading: () {
        // Continue showing splash
      },
      error: (_, __) {
        Navigator.pushReplacementNamed(context, AppRoutes.auth);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).primaryColor,
      body: Center(
        child: AnimatedBuilder(
          animation: _animationController,
          builder: (context, child) {
            return FadeTransition(
              opacity: _fadeAnimation,
              child: ScaleTransition(
                scale: _scaleAnimation,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    // App Logo
                    Container(
                      width: 120,
                      height: 120,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(20),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.1),
                            blurRadius: 10,
                            offset: Offset(0, 5),
                          ),
                        ],
                      ),
                      child: Icon(
                        Icons.location_on,
                        size: 60,
                        color: Theme.of(context).primaryColor,
                      ),
                    ),
                    
                    SizedBox(height: 30),
                    
                    // App Name
                    Text(
                      'NearChat',
                      style: TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                        letterSpacing: 2,
                      ),
                    ),
                    
                    SizedBox(height: 10),
                    
                    // Tagline
                    Text(
                      'Connect with people nearby',
                      style: TextStyle(
                        fontSize: 16,
                        color: Colors.white.withOpacity(0.8),
                      ),
                    ),
                    
                    SizedBox(height: 50),
                    
                    // Loading indicator
                    CircularProgressIndicator(
                      valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

// Helper functions
Future<void> _requestPermissions() async {
  try {
    // Location permissions
    await Permission.location.request();
    await Permission.locationWhenInUse.request();
    
    // Camera permissions
    await Permission.camera.request();
    
    // Microphone permissions
    await Permission.microphone.request();
    
    // Storage permissions
    await Permission.storage.request();
    
    // Notification permissions
    await Permission.notification.request();
    
    Logger.info('Permissions requested successfully');
  } catch (e) {
    Logger.error('Error requesting permissions: $e');
  }
}

Future<void> _initializeServices() async {
  try {
    // Initialize API service
    await ApiService.initialize();
    
    // Initialize location service
    await LocationService.initialize();
    
    // Initialize socket service
    await SocketService.initialize();
    
    // Initialize ad service
    await AdService.initialize();
    
    Logger.info('Services initialized successfully');
  } catch (e) {
    Logger.error('Error initializing services: $e');
  }
}