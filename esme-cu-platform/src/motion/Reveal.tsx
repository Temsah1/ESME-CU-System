import React from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';
import { viewport } from './tokens';
import { fadeUp, groupItem, staggerGroup } from './variants';

type RevealProps = HTMLMotionProps<'div'> & {
  y?: number;
  delay?: number;
  amount?: number;
  once?: boolean;
};

export const Reveal: React.FC<RevealProps> = ({ y = 24, delay = 0, amount, once = true, children, ...rest }) => (
  <motion.div
    initial="hidden"
    whileInView="visible"
    viewport={{ once, amount: amount ?? viewport.reveal.amount }}
    variants={{
      hidden: { opacity: 0, y },
      visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1], delay } },
    }}
    {...rest}
  >
    {children}
  </motion.div>
);

type StaggerGroupProps = HTMLMotionProps<'div'> & {
  step?: number;
  delayChildren?: number;
  amount?: number;
};

export const StaggerGroup: React.FC<StaggerGroupProps> = ({ step, delayChildren, amount, children, ...rest }) => (
  <motion.div
    initial="hidden"
    whileInView="visible"
    viewport={{ once: true, amount: amount ?? 0.15 }}
    variants={staggerGroup(step, delayChildren)}
    {...rest}
  >
    {children}
  </motion.div>
);

export const StaggerItem: React.FC<HTMLMotionProps<'div'> & { variants?: typeof groupItem }> = ({ children, variants, ...rest }) => (
  <motion.div variants={variants ?? groupItem} {...rest}>
    {children}
  </motion.div>
);
