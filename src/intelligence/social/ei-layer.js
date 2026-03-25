/**
 * EILayer - Emotional Intelligence utility layer
 * Adjusts prompt tone and presentation based on emotional/trust signals
 */
import ModuleBase from '../../core/module-base.js';
import { DIM_EMOTION, DIM_TRUST } from '../../core/field/types.js';

class EILayer extends ModuleBase {
  constructor({ field }) {
    super();
    this.field = field;
  }

  static produces() { return []; }
  static consumes() { return [DIM_EMOTION, DIM_TRUST]; }
  static publishes() { return []; }
  static subscribes() { return []; }

  adjustPromptTone(basePrompt, perceivedField) {
    if (!perceivedField) return basePrompt;

    const { emotion = 0, trust = 0.5 } = perceivedField;
    const additions = [];

    if (emotion > 0.6) {
      additions.push(
        '\u6ce8\u610f\uff1a\u524d\u51e0\u8f6e\u51fa\u73b0\u4e86\u56f0\u96be\uff0c\u8bf7\u5728\u5c1d\u8bd5\u65b0\u65b9\u6848\u524d\u5148\u5206\u6790\u5931\u8d25\u539f\u56e0\uff0c\u6362\u4e2a\u89d2\u5ea6\u601d\u8003\u3002'
      );
    }

    if (trust < 0.3) {
      additions.push(
        '\u4f60\u7684\u8f93\u51fa\u5c06\u63a5\u53d7\u66f4\u4e25\u683c\u7684\u5ba1\u67e5\uff0c\u8bf7\u786e\u4fdd\u6bcf\u4e2a\u6539\u52a8\u90fd\u6709\u5145\u5206\u7406\u7531\u548c\u6d4b\u8bd5\u8986\u76d6\u3002'
      );
    }

    if (emotion < 0.2 && trust > 0.7) {
      additions.push(
        '\u5f53\u524d\u8fdb\u5c55\u987a\u5229\uff0c\u4fdd\u6301\u8282\u594f\uff0c\u6ce8\u610f\u4e0d\u8981\u8fc7\u5ea6\u81ea\u4fe1\u8df3\u8fc7\u9a8c\u8bc1\u6b65\u9aa4\u3002'
      );
    }

    if (additions.length === 0) return basePrompt;
    return basePrompt + '\n\n' + additions.join('\n');
  }

  adjustPresentation(result, userProfile) {
    if (!userProfile || !userProfile.communicationStyle) return result;

    const style = userProfile.communicationStyle;
    if (typeof result !== 'string') return result;

    switch (style) {
      case 'concise':
        // Trim to first paragraph or first 500 chars
        return result.split('\n\n')[0].slice(0, 500);
      case 'detailed':
        return result;
      case 'structured':
        // Wrap in markdown sections if not already structured
        if (!result.includes('##')) {
          return `## Result\n\n${result}`;
        }
        return result;
      default:
        return result;
    }
  }

  suggestTone(emotionVector) {
    if (!emotionVector) return 'neutral';
    const { frustration = 0, confidence = 0, fatigue = 0 } = emotionVector;

    if (frustration > 0.6) return 'encouraging';
    if (confidence > 0.8) return 'cautious';
    if (fatigue > 0.7) return 'focused';
    return 'neutral';
  }
}

export { EILayer };
export default EILayer;
