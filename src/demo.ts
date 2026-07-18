import type { AuthorProfile, DocumentSession } from "./domain";
import { hashText } from "./filesystem";

export const DEMO_AUTHOR: AuthorProfile = {
  name: "折页实验室",
  date: "2026年7月16日",
  column: "AI 小白教程",
  wordmark: "折",
};

export const DEMO_MARKDOWN = `---
title: 用两遍 AI 对话，学懂一个原本看不懂的概念
author: 折页实验室
---

很多人以为，用 AI 学习就是把问题丢进去，然后等它给答案。

但我最近发现，真正有用的不是“让 AI 讲一遍”，而是让它带着你完成两次完全不同的对话。

**第一遍负责听懂，第二遍负责证明你真的懂了。**

## 第一遍：先把陌生概念翻译成人话

不要一上来就让 AI 给你完整教程。你只需要告诉它三件事：你是谁、哪里看不懂、希望它用什么例子解释。

> [!tip] 一个好用的开场
> 我没有技术背景，请用“整理房间”的例子解释 Transformer。每次只讲一个概念，并在结尾问我是否听懂。

![第一次对话的结果](/demo/dialogue.png)

当 AI 开始使用术语时，马上追问：“这句话如果不能用术语，要怎么说？”

这样做的目标不是记住定义，而是先建立一个可以在脑中移动的画面。

<!-- xhs-page-break -->

## 第二遍：关掉答案，逼自己复述

新开一个对话，不要把第一遍的聊天记录带过去。先用自己的话讲一遍刚才理解的内容，再让 AI 只做三件事：

1. 标出我说对的部分。
2. 找出我偷换或漏掉的概念。
3. 给一个最小练习，让我重新解释一次。

![第二遍复述检查](/demo/review.png)

你会很快发现：**“看懂了”只是一种熟悉感，“能复述”才是可验证的理解。**

## 最后留下一个可以重复的动作

以后遇到论文、报告或者陌生工具，不要再收藏一堆链接。只做两遍：

- 第一遍，把术语换成画面。
- 第二遍，把画面重新讲成自己的话。

如果第二遍讲不出来，就回到第一遍继续追问。这个循环，比让 AI 一次生成十页笔记更慢一点，但也更不容易白学。
`;

export async function createDemoSession(): Promise<DocumentSession> {
  const hash = await hashText(DEMO_MARKDOWN);
  return {
    id: "demo:two-pass-learning",
    mode: "demo",
    label: "两遍 AI 对话学习法",
    path: "示例/两遍 AI 对话学习法.md",
    text: DEMO_MARKDOWN,
    baseText: DEMO_MARKDOWN,
    baseHash: hash,
    lastModified: Date.now(),
    writable: false,
  };
}
