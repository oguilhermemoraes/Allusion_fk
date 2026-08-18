import { observer } from 'mobx-react-lite';
import React, { useState, useCallback } from 'react';
import { IconSet } from 'widgets';

export interface StarRatingProps {
  rating?: number;
  onChange?: (rating: number) => void;
  readonly?: boolean;
  size?: 'small' | 'medium' | 'large';
  showClear?: boolean;
  className?: string;
}

export const StarRating: React.FC<StarRatingProps> = observer(({
  rating = 0,
  onChange,
  readonly = false,
  size = 'medium',
  showClear = true,
  className = '',
}) => {
  const [hoverRating, setHoverRating] = useState<number | null>(null);

  const displayRating = hoverRating !== null ? hoverRating : rating;

  const handleClick = useCallback(
    (starIndex: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (readonly || !onChange) return;
      // If clicking the current rating, clear to 0
      if (rating === starIndex) {
        onChange(0);
      } else {
        onChange(starIndex);
      }
    },
    [onChange, rating, readonly],
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (readonly || !onChange) return;
      onChange(0);
    },
    [onChange, readonly],
  );

  const sizeClass = size === 'small' ? 'star-rating-sm' : size === 'large' ? 'star-rating-lg' : 'star-rating-md';

  return (
    <div
      className={`star-rating-container ${sizeClass} ${readonly ? 'star-rating-readonly' : ''} ${className}`}
      onMouseLeave={() => !readonly && setHoverRating(null)}
      role="group"
      aria-label={`Rating: ${rating} of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((starIndex) => {
        const isFilled = starIndex <= displayRating;
        return (
          <button
            key={starIndex}
            type="button"
            className={`star-rating-btn ${isFilled ? 'star-filled' : 'star-empty'}`}
            onClick={(e) => handleClick(starIndex, e)}
            onMouseEnter={() => !readonly && setHoverRating(starIndex)}
            disabled={readonly}
            title={readonly ? `${rating} stars` : `Rate ${starIndex} star${starIndex > 1 ? 's' : ''}`}
            aria-label={`${starIndex} star${starIndex > 1 ? 's' : ''}`}
          >
            {isFilled ? IconSet.STAR_FILL : IconSet.STAR_OUTLINE}
          </button>
        );
      })}

      {!readonly && showClear && rating > 0 && (
        <button
          type="button"
          className="star-rating-clear-btn btn-icon"
          onClick={handleClear}
          title="Clear rating"
          aria-label="Clear rating"
        >
          {IconSet.CLOSE}
        </button>
      )}
    </div>
  );
});

export default StarRating;
