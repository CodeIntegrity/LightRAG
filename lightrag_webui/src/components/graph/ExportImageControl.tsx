import { useSigma } from '@react-sigma/core'
import { Download } from 'lucide-react'
import { controlButtonVariant } from '@/lib/constants'
import Button from '@/components/ui/Button'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/**
 * Component that exports the graph as an image.
 * Uses drawImage with proper timing to capture WebGL content.
 */
const ExportImageControl = () => {
  const sigma = useSigma()
  const { t } = useTranslation()

  const handleExport = async () => {
    try {
      // 获取 sigma 容器
      const sigmaContainer = document.querySelector('.sigma-container') ||
        document.querySelector('[class*="sigma"]');

      if (!sigmaContainer) {
        console.error('Sigma container not found');
        toast.error(t('graphPanel.sideBar.exportImageControl.exportFailed'));
        return;
      }

      // 显示加载提示
      const loadingToast = toast.loading(t('graphPanel.sideBar.exportImageControl.exporting') || '正在导出...');

      try {
        // 获取所有 canvas
        const canvases = Array.from(sigmaContainer.querySelectorAll('canvas')) as HTMLCanvasElement[];
        
        if (canvases.length === 0) {
          throw new Error('No canvases found');
        }

        console.log(`Found ${canvases.length} canvases`);

        // 创建临时 canvas
        const firstCanvas = canvases[0];
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = firstCanvas.width;
        tempCanvas.height = firstCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        if (!tempCtx) {
          throw new Error('Cannot get 2D context');
        }

        // 填充白色背景
        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // 多次强制刷新以确保 WebGL 缓冲区有内容
        for (let i = 0; i < 3; i++) {
          sigma.refresh();
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        
        // 额外等待确保渲染完成
        await new Promise(resolve => setTimeout(resolve, 200));

        // 依次绘制所有 canvas 层
        let drawnCount = 0;
        for (let i = 0; i < canvases.length; i++) {
          const canvas = canvases[i];
          try {
            if (canvas.width > 0 && canvas.height > 0) {
              // 对于每个 canvas，再次刷新后立即绘制
              if (i === 0) {
                // 第一个 canvas（通常是 WebGL 层）特殊处理
                sigma.refresh();
                await new Promise(resolve => requestAnimationFrame(resolve));
              }
              
              tempCtx.drawImage(canvas, 0, 0);
              drawnCount++;
              console.log(` Drew canvas ${i} (${canvas.width}x${canvas.height})`);
            }
          } catch (error) {
            console.warn(`Failed to draw canvas ${i}:`, error);
          }
        }

        console.log(`Successfully drew ${drawnCount} canvas layers`);

        // 导出
        const dataURL = tempCanvas.toDataURL('image/png');
        
        if (!dataURL || dataURL.length < 1000) {
          throw new Error('Generated image is too small or empty');
        }

        console.log('Exported image data length:', dataURL.length);

        const link = document.createElement('a');
        link.download = `graph-${new Date().getTime()}.png`;
        link.href = dataURL;
        link.click();

        toast.dismiss(loadingToast);
        toast.success(t('graphPanel.sideBar.exportImageControl.exportSuccess'));
      } catch (error) {
        toast.dismiss(loadingToast);
        throw error;
      }
    } catch (error) {
      console.error('Export failed:', error);
      toast.error(t('graphPanel.sideBar.exportImageControl.exportFailed') + ': ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  return (
    <Button
      variant={controlButtonVariant}
      onClick={handleExport}
      tooltip={t('graphPanel.sideBar.exportImageControl.export')}
      size="icon"
    >
      <Download />
    </Button>
  )
}

export default ExportImageControl
