import React from 'react';
import { motion } from 'motion/react';
import { stagger } from './tokens';
import { staggerGroup, wordItem } from './variants';

interface WordRevealProps {
  text: string;
  className?: string;
  step?: number;
  delayChildren?: number;
}

export const WordReveal: React.FC<WordRevealProps> = ({
  text,
  className,
  step = stagger.hero,
  delayChildren = 0.1,
}) => {
  const words = text.split(' ');
  return (
    <motion.span
      className={className}
      variants={staggerGroup(step, delayChildren)}
      initial="hidden"
      animate="visible"
      aria-label={text}
    >
      {words.map((word, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[0.08em] align-top" aria-hidden="true">
          <motion.span variants={wordItem} className="inline-block">
            {word}
          </motion.span>
          {i < words.length - 1 ? <span className="inline-block">&nbsp;</span> : null}
        </span>
      ))}
    </motion.span>
  );
};
