import { FolderTree } from 'lucide-react';
import { EmptyState } from '@renderer/ui/components/EmptyState';

export function ScenePanel() {
  return <EmptyState icon={FolderTree} message="No project open. The scene tree lists parts once a model is imported." />;
}
