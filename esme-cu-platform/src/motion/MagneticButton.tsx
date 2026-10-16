import React, { useRef } from 'react';
import { motion, useMotionValue, useSpring, type HTMLMotionProps } from 'motion/react';
import { usePremiumMotion } from './hooks';
import { transitions } from './tokens';

type MagneticButtonProps = HTMLMotionProps<'button'> & {
  strength?: number;
};

export const MagneticButton: React.FC<MagneticButtonProps> = ({
  strength = 0.25,
  onMouseMove,
  onMouseLeave,
  children,
  ...rest
}) => {
  const ref = useRef<HTMLButtonElement>(null);
  const premium = usePremiumMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 300, damping: 22, mass: 0.4 });
  const springY = useSpring(y, { stiffness: 300, damping: 22, mass: 0.4 });

  const handleMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    onMouseMove?.(e);
    if (!premium || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    x.set((e.clientX - (rect.left + rect.width / 2)) * strength);
    y.set((e.clientY - (rect.top + rect.height / 2)) * strength);
  };

  const reset = (e: React.MouseEvent<HTMLButtonElement>) => {
    onMouseLeave?.(e);
    x.set(0);
    y.set(0);
  };

  return (
    <motion.button
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={reset}
      style={{ x: springX, y: springY }}
      whileHover={{ scale: 1.03, transition: transitions.micro }}
      whileTap={{ scale: 0.97, transition: transitions.micro }}
      {...rest}
    >
      {children}
    </motion.button>
  );
};

