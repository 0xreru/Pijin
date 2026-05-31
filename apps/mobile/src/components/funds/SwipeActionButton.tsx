import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  PanResponder,
  PanResponderGestureState,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { radius } from '../../constants/radius';
import { spacing } from '../../constants/spacing';
import { colors } from '../../constants/theme';
import { typography } from '../../constants/typography';

const KNOB_SIZE = 65;
const COMPLETE_THRESHOLD = 0.75;

type SwipeActionButtonProps = {
  label?: string;
  title?: string;
  completeLabel?: string;
  disabled?: boolean;
  onComplete?: () => void;
  onPress?: () => void;
};

export function SwipeActionButton({
  label,
  title,
  completeLabel = 'COMPLETE',
  disabled = false,
  onComplete,
  onPress,
}: SwipeActionButtonProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const latestTranslateX = useRef(0);
  const dragStartTranslateX = useRef(0);
  const displayLabel = isComplete ? completeLabel : label ?? title;
  const maxTranslateX = Math.max(containerWidth - KNOB_SIZE, 0);

  function updatePosition(value: number) {
    const clampedValue = Math.min(Math.max(value, 0), maxTranslateX);

    latestTranslateX.current = clampedValue;
    translateX.setValue(clampedValue);
  }

  function reset() {
    setIsCompleting(false);
    setIsComplete(false);
    latestTranslateX.current = 0;
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
    }).start();
  }

  function complete() {
    if (isCompleting) {
      return;
    }

    setIsCompleting(true);
    Animated.timing(translateX, {
      toValue: maxTranslateX,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) {
        setIsCompleting(false);
        return;
      }

      latestTranslateX.current = maxTranslateX;
      setIsComplete(true);
      if (onComplete) {
        onComplete();
      } else {
        onPress?.();
      }
      reset();
    });
  }

  function handleRelease(_: unknown, gestureState: PanResponderGestureState) {
    const releasePosition = dragStartTranslateX.current + gestureState.dx;

    if (releasePosition >= maxTranslateX * COMPLETE_THRESHOLD) {
      complete();
      return;
    }

    reset();
  }

  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) =>
      !disabled && !isCompleting && maxTranslateX > 0 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
    onPanResponderGrant: () => {
      translateX.stopAnimation((value) => {
        latestTranslateX.current = value;
        dragStartTranslateX.current = value;
      });
    },
    onPanResponderMove: (_, gestureState) => {
      updatePosition(dragStartTranslateX.current + gestureState.dx);
    },
    onPanResponderRelease: handleRelease,
    onPanResponderTerminate: reset,
  });

  const panHandlers = disabled
    ? {}
    : panResponder.panHandlers;

  function handleLayout(event: LayoutChangeEvent) {
    setContainerWidth(event.nativeEvent.layout.width);
  }

  return (
    <View
      onLayout={handleLayout}
      style={[styles.track, disabled && styles.disabled]}
      accessibilityRole="adjustable"
      accessibilityLabel={displayLabel}
    >
      <Animated.View
        {...panHandlers}
        style={[styles.thumb, { transform: [{ translateX }] }]}
      >
        <Ionicons name="lock-closed-outline" size={31} color={colors.surface} />
      </Animated.View>
      <Text style={styles.title}>{displayLabel}</Text>
      <Ionicons name="chevron-forward" size={24} color={colors.mutedDark} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 63,
    borderRadius: radius.pill,
    backgroundColor: colors.pill,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.xl,
    overflow: 'hidden',
  },
  disabled: {
    opacity: 0.58,
  },
  thumb: {
    position: 'absolute',
    left: -1,
    zIndex: 1,
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: 33,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.button,
    color: colors.mutedDark,
    flex: 1,
    textAlign: 'center',
    fontSize: 13,
    paddingLeft: KNOB_SIZE,
  },
});
