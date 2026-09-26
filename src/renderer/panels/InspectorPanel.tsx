import { SlidersHorizontal } from 'lucide-react';
import { EmptyState } from '@renderer/ui/components/EmptyState';

export function InspectorPanel() {
  return <EmptyState icon={SlidersHorizontal} message="Nothing selected. Select a part, node or beam to edit its properties." />;
}
