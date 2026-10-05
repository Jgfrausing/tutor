import { forwardRef, useState } from "react";
import { NODE } from "../lib/boot";
import { decode } from "../lib/dom";
import type { TopicCard } from "../types";
import { MathText } from "./MathText";
import { SayPhrase } from "./SayControls";

interface Props {
  card: TopicCard;
  big: boolean;
  flipped?: boolean;
  label?: string;
  onClick?(): void;
}

export const FlipCard = forwardRef<HTMLButtonElement, Props>(function FlipCard({ card, big, flipped, label, onClick }, ref) {
  const [own, setOwn] = useState(false);
  const isFlipped = flipped === undefined ? own : flipped;
  const click = () => {
    if (flipped === undefined) setOwn(f => !f);
    if (onClick) onClick();
  };
  return (
    <button ref={ref} className={"flip" + (isFlipped ? " flipped" : "")} type="button" aria-label={label || "Flip card"} onClick={click}>
      <span className="flip-inner">
        <span className="face front"><small>{big ? NODE[card.topic].title : "Front"}</small><MathText className="txt" text={decode(card.front)} /></span>
        <span className="face back"><small>Back</small>{card.say ? <SayPhrase text={card.say} /> : null}<MathText className="txt" text={decode(card.back)} /></span>
      </span>
    </button>
  );
});
