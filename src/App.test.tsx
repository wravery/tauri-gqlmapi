import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders documentation explorer button', () => {
  render(<App />);
  const buttonElement = screen.getByLabelText(/documentation explorer/i);
  expect(buttonElement).toBeInTheDocument();
});
