import type { TakeStyle } from '../types/song';

interface TakeSelectorProps {
  selectedTake: TakeStyle | 'OFF';
  locked: boolean;
  autoTacet: boolean;
  disabled: boolean;
  onSelect: (take: TakeStyle | 'OFF') => void;
}

const OPTIONS: Array<{ value: TakeStyle | 'OFF'; label: string }> = [
  { value: 'A', label: 'Take A' },
  { value: 'B', label: 'Take B' },
  { value: 'C', label: 'Take C' },
  { value: 'OFF', label: 'OFF' },
];

export function TakeSelector({
  selectedTake,
  locked,
  autoTacet,
  disabled,
  onSelect,
}: TakeSelectorProps) {
  return (
    <div className="take-selector-wrap">
      <div className="take-selector" role="group" aria-label="Take Selector">
        {OPTIONS.map((opt) => {
          const isActive = selectedTake === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              className={`take-btn ${isActive ? 'active' : ''} ${
                opt.value === 'OFF' ? 'off-btn' : ''
              }`}
              disabled={locked || disabled}
              onClick={() => onSelect(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {autoTacet && !disabled && (
        <span className="badge badge-tacet">Auto Tacet</span>
      )}
    </div>
  );
}
