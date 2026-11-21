const questionForm = document.getElementById('question-form');
const questionStatus = document.getElementById('question-status');
const questionSubmit = questionForm.querySelector('button[type="submit"]');

questionForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (questionSubmit.disabled) return;

  questionSubmit.disabled = true;
  delete questionStatus.dataset.state;
  questionStatus.textContent = 'Отправляем вопрос…';
  try {
    const response = await fetch(questionForm.action, {
      method: 'POST',
      body: new FormData(questionForm),
      credentials: 'omit'
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true) {
      questionStatus.dataset.state = 'error';
      questionStatus.textContent = result.error || 'Не удалось отправить вопрос. Попробуйте ещё раз.';
      return;
    }
    questionForm.reset();
    questionStatus.dataset.state = 'success';
    questionStatus.textContent = 'Вопрос отправлен. Ответим по указанному контакту.';
  } catch {
    questionStatus.dataset.state = 'error';
    questionStatus.textContent = 'Не удалось отправить вопрос. Попробуйте ещё раз.';
  } finally {
    questionSubmit.disabled = false;
  }
});

questionSubmit.disabled = false;
