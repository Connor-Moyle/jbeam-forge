import { Palette } from 'lucide-react';
import { EmptyState } from '@renderer/ui/components/EmptyState';

export function MaterialsPanel() {
  return <EmptyState icon={Palette} message="No materials yet. Materials appear here after importing a model." />;
}
