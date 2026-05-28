! Construct 06: Polymorphism and Dynamic Dispatch
! Demonstrates: CLASS hierarchy, SELECT TYPE dispatch, vtable in FIR,
!               fir.dispatch_table, indirect function pointers in LLVM IR
module shapes
  implicit none

  type :: Shape
    real :: color(3)
  contains
    procedure :: area   => shape_area
    procedure :: perimeter => shape_perimeter
  end type Shape

  type, extends(Shape) :: Circle
    real :: radius
  contains
    procedure :: area      => circle_area
    procedure :: perimeter => circle_perimeter
  end type Circle

  type, extends(Shape) :: Rectangle
    real :: width, height
  contains
    procedure :: area      => rect_area
    procedure :: perimeter => rect_perimeter
  end type Rectangle

contains

  function shape_area(self) result(a)
    class(Shape), intent(in) :: self
    real :: a
    a = 0.0
  end function shape_area

  function shape_perimeter(self) result(p)
    class(Shape), intent(in) :: self
    real :: p
    p = 0.0
  end function shape_perimeter

  function circle_area(self) result(a)
    class(Circle), intent(in) :: self
    real :: a
    a = 3.14159265 * self%radius * self%radius
  end function circle_area

  function circle_perimeter(self) result(p)
    class(Circle), intent(in) :: self
    real :: p
    p = 2.0 * 3.14159265 * self%radius
  end function circle_perimeter

  function rect_area(self) result(a)
    class(Rectangle), intent(in) :: self
    real :: a
    a = self%width * self%height
  end function rect_area

  function rect_perimeter(self) result(p)
    class(Rectangle), intent(in) :: self
    real :: p
    p = 2.0 * (self%width + self%height)
  end function rect_perimeter

  ! Dynamic dispatch — SELECT TYPE triggers vtable lookup
  subroutine print_shape_info(s)
    class(Shape), intent(in) :: s
    real :: a, per

    ! fir.dispatch calls route through the vtable
    a   = s%area()
    per = s%perimeter()

    SELECT TYPE (s)
      TYPE IS (Circle)
        print *, "Circle: radius=", s%radius, " area=", a
      TYPE IS (Rectangle)
        print *, "Rect:   ", s%width, "x", s%height, " area=", a
      CLASS DEFAULT
        print *, "Shape: area=", a
    END SELECT
  end subroutine print_shape_info

end module shapes
