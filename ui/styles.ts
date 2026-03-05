import { css, keyframes } from "goober";

export const base = css`
  font-family: var(--aai-font);
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
  color: var(--aai-text);
`;

export const layout = css`
  min-height: 100vh;
  box-sizing: border-box;
`;

export const hero = css`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;

  & button {
    padding: 16px 32px;
    border: none;
    border-radius: var(--aai-radius);
    background: var(--aai-primary);
    color: var(--aai-text);
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
  }
`;

export const indicator = css`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;

  & .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  & .label {
    font-size: 14px;
    color: var(--aai-text-muted);
    text-transform: capitalize;
  }
`;

export const errorBanner = css`
  background: var(--aai-surface);
  color: var(--aai-error);
  padding: 10px 14px;
  border-radius: var(--aai-radius);
  margin-bottom: 16px;
  font-size: 14px;
`;

export const messageArea = css`
  min-height: 300px;
  max-height: 500px;
  overflow-y: auto;
  margin-bottom: 16px;
  border: 1px solid var(--aai-surface-light);
  border-radius: var(--aai-radius);
  padding: 16px;
`;

export const controls = css`
  display: flex;
  gap: 8px;

  & button {
    padding: 8px 16px;
    border: none;
    border-radius: var(--aai-radius);
    cursor: pointer;
    font-size: 14px;
    color: var(--aai-text);
  }
  & .reset {
    border: 1px solid var(--aai-surface-light);
    background: transparent;
    color: var(--aai-text-muted);
  }
`;

const bounce = keyframes`
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
`;

export const thinking = css`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  margin-bottom: 12px;

  & .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--aai-text-muted);
    animation: ${bounce} 1.4s infinite ease-in-out both;
  }
  & .dot:nth-child(1) {
    animation-delay: 0s;
  }
  & .dot:nth-child(2) {
    animation-delay: 0.16s;
  }
  & .dot:nth-child(3) {
    animation-delay: 0.32s;
  }
`;

export const bubble = css`
  margin-bottom: 12px;

  &.user {
    text-align: right;
  }

  & .content {
    display: inline-block;
    max-width: 80%;
    padding: 8px 12px;
    border-radius: var(--aai-radius);
    text-align: left;
    font-size: 14px;
    background: var(--aai-surface);
  }
  &.user .content {
    background: var(--aai-surface-light);
  }

  &.transcript .content {
    background: var(--aai-surface-light);
    opacity: 0.6;
  }
`;
