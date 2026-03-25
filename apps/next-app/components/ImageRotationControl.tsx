'use client';

import { RotateCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Lang } from '@/lib/i18n';
import type { ImageRotation } from '@/lib/oriented-image';

const translations = {
  fr: {
    rotate: 'Tourner 90°',
    orientation: 'Orientation',
  },
  en: {
    rotate: 'Rotate 90°',
    orientation: 'Orientation',
  },
} as const;

type ImageRotationControlProps = {
  lang: Lang;
  onRotate: () => void;
  rotation: ImageRotation;
};

export function ImageRotationControl({ lang, onRotate, rotation }: ImageRotationControlProps) {
  const t = translations[lang];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onRotate}>
        <RotateCw className="h-4 w-4" />
        {t.rotate}
      </Button>
      {rotation !== 0 ? <Badge variant="outline">{t.orientation} {rotation}°</Badge> : null}
    </div>
  );
}
