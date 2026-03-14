/**
 * 双语标签组件 / Bilingual Label Component
 *
 * 同时渲染英文和中文文本，使用全局 .bi-label 样式。
 * Renders both English and Chinese text using the global .bi-label styles.
 *
 * @module console/components/BilingualLabel
 * @author DEEP-IOS
 */

/**
 * 双语标签 / Bilingual Label
 *
 * @param {object} props
 * @param {string} props.en - 英文文本 / English text
 * @param {string} props.zh - 中文文本 / Chinese text
 * @param {string} [props.className=''] - 附加 CSS 类名 / Additional CSS class names
 * @returns {JSX.Element}
 */
export default function BilingualLabel({ en, zh, className = '' }) {
  return (
    <span className={`bi-label ${className}`}>
      <span className="en">{en}</span>
      <span className="zh">{zh}</span>
    </span>
  );
}
