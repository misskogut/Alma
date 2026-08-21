# Research Engine

## Исследование начинается с вопроса

Research Quest позволяет прийти с вопросом вроде «Почему у меня болит голова?» без требования заполнить десятки полей. Quest хранит target, несколько конкурирующих hypotheses, required/optional metrics, progress и dossier.

## Lifecycle

`suggested → active ↔ paused → sufficient_result → completed/background_monitoring`, с возможностью `reactivated`, если персональная модель изменилась.

## Multiple hypotheses

Hypothesis содержит factors, modifiers, relationship type, prior/evidence score, status и источник. Личный вопрос и scientific/population prior могут только предлагать стартовую гипотезу; результат определяется персональным evidence.

## Minimal input

Input Request Engine оценивает information value, uncertainty reduction, research relevance, urgency и effort. Одинаковый вопрос для нескольких quests объединяется. По умолчанию UI показывает один лучший запрос; просроченный субъективный вопрос закрывается, а не превращается в долг по заполнению.

## Dossier

Dossier сохраняет поддержанные/ослабленные hypotheses, найденные modifiers, связанные personal tools и experiments. Достаточность результата требует coverage, opportunities и повторяющегося pattern, а не простого количества дней.
