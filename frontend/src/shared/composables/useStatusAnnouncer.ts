import { ref } from 'vue'

const message = ref('')
const errorMessage = ref('')

export function useStatusAnnouncer() {
  function announce(msg: string) {
    message.value = ''
    setTimeout(() => { message.value = msg }, 50)
  }
  function announceError(msg: string) {
    errorMessage.value = ''
    setTimeout(() => { errorMessage.value = msg }, 50)
  }
  return { message, errorMessage, announce, announceError }
}
