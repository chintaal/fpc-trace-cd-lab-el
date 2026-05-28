! Construct 07: Coarray Remote Memory Access (CAF)
! Demonstrates: Coarray indexing lowering, _caf_get/_caf_put runtime calls,
!               fir.global_len, image_index expressions
subroutine coarray_halo_exchange(a, n)
  implicit none
  integer, intent(in) :: n
  real, intent(inout) :: a(n)[*]   ! coarray: one copy per image

  integer :: me, nimg

  me   = THIS_IMAGE()
  nimg = NUM_IMAGES()

  ! Halo exchange: get neighbour data
  ! a[me-1] triggers a _caf_get runtime call
  if (me > 1) then
    a(1) = a(n)[me - 1]   ! remote read from left neighbour
  end if

  if (me < nimg) then
    a(n) = a(1)[me + 1]   ! remote read from right neighbour
  end if

  ! Sync before using received data
  SYNC ALL

end subroutine coarray_halo_exchange

subroutine coarray_broadcast(val)
  implicit none
  real, intent(inout) :: val[*]

  ! Image 1 broadcasts its value to all others
  if (THIS_IMAGE() /= 1) then
    val = val[1]   ! fir.call @_caf_get
  end if
  SYNC ALL

end subroutine coarray_broadcast
